import { EventEmitter } from 'node:events';
import { ethers } from 'ethers';
import { config } from './config.js';
import * as chain from './chain.js';
import { askJev } from './jev.js';
import { ledger, openLedger, addBurn, addDecision, syncBurns } from './ledger.js';

export const events = new EventEmitter();
export const live = {
  mode: !config.token ? 'standby' : !chain.wallet || !config.jevKey ? 'watch' : config.dryRun ? 'rehearsal' : 'live',
  launch: null,
  head: 0,
  supply: null,
  price: null,
  market: null,
  furnace: null,
  status: 'warming up',
  nextLookAt: 0,
};

let BLOCKS_PER_MIN = 600;

// the rulebook. the site prints these, so what it says jev does is what the code does.
export const RULES = {
  intervalSec: config.intervalSec,
  minConfidence: config.minConfidence,
  chasingMax: 0.7, // never buy when jev's "chasing a pump" read is at or above this
  sizeMin: 0.15, // share of the budget for jev's smallest size
  sizeMax: 0.6, // and for its largest
  heartbeatFrac: 0.2,
  maxIdleMin: config.maxIdleMin,
  minBuyEth: config.minBuyEth,
  maxBuyEth: config.maxBuyEth,
  slippageBps: config.slippageBps,
};
const eth = (wei) => Number(ethers.formatEther(wei));
const round = (n, d = 2) => Number(n.toFixed(d));
let lastActionTs = Date.now();

function marketStats(trades, head, price) {
  const since = (mins) => trades.filter((t) => t.block >= head - mins * BLOCKS_PER_MIN);
  const flow = (list) => ({
    buys_eth: round(list.filter((t) => t.side === 'buy').reduce((s, t) => s + t.eth, 0), 5),
    sells_eth: round(list.filter((t) => t.side === 'sell').reduce((s, t) => s + t.eth, 0), 5),
    trades: list.length,
  });
  // price just before a window opened: last trade older than it, else the oldest we know
  const priceAt = (mins) => {
    const older = trades.filter((t) => t.block < head - mins * BLOCKS_PER_MIN);
    return older.length ? older[older.length - 1].price : trades[0]?.price ?? price;
  };
  const change = (mins) => round((price / priceAt(mins) - 1) * 100);
  const high = Math.max(price, ...trades.map((t) => t.price));
  return {
    price_eth: price,
    price_change_15m_pct: change(15),
    price_change_2h_pct: change(120),
    vs_2h_high_pct: round((price / high - 1) * 100),
    last_15m: flow(since(15)),
    last_2h: flow(trades),
  };
}

async function think(launch) {
  const minWei = ethers.parseEther(String(config.minBuyEth));
  await chain.collectFees(launch, minWei);
  const leftover = await chain.burnLeftovers(launch);
  if (leftover) {
    addBurn({ ts: Date.now(), block: live.head, ethSpent: '0', tokensBurned: leftover.tokensBurned.toString(), venue: null, buyTx: null, burnTx: leftover.burnTx, reason: 'sweep' });
    events.emit('burn');
  }

  live.furnace = await chain.readFurnace();
  const budget = config.dryRun ? config.dryBudgetEth : Math.max(0, eth(live.furnace.balance) - config.gasReserveEth);
  if (budget < config.minBuyEth) {
    live.status = 'waiting for fees';
    return;
  }

  const idleMin = Math.floor((Date.now() - lastActionTs) / 60000);
  const state = {
    token: { symbol: launch.symbol, venue: launch.phase === 'curve' ? 'bonding curve' : 'uniswap v4 pool', supply_burned_pct: live.supply.pct },
    market: live.market,
    furnace: { budget_eth: round(budget, 5), minutes_since_last_buyback: idleMin },
  };
  const jev = await askJev(state);

  const chasing = jev.chasing >= RULES.chasingMax;
  let reason = null;
  if (jev.choice === 'buy_now' && jev.confidence >= config.minConfidence && !chasing) reason = 'jev';
  else if (idleMin >= config.maxIdleMin && !chasing) reason = 'heartbeat';

  const decision = { ts: Date.now(), ...jev, market: live.market, budgetEth: round(budget, 5), idleMin, outcome: 'waited', reason };
  if (reason) {
    const size = Math.min(2, Math.max(0, jev.size));
    const frac = reason === 'jev' ? RULES.sizeMin + ((RULES.sizeMax - RULES.sizeMin) * size) / 2 : RULES.heartbeatFrac;
    decision.frac = round(frac, 3);
    const amountEth = Math.min(Math.max(budget * frac, config.minBuyEth), config.maxBuyEth, budget);
    const amountWei = ethers.parseEther(amountEth.toFixed(18));
    try {
      const r = await chain.buyAndBurn(launch, amountWei);
      lastActionTs = Date.now();
      decision.amountEth = eth(r.ethSpent);
      decision.tokens = eth(r.tokensBurned);
      decision.outcome = config.dryRun ? 'rehearsed' : 'burned';
      decision.venue = r.venue;
      decision.buyTx = r.buyTx;
      decision.burnTx = r.burnTx;
      if (!config.dryRun) {
        addBurn({ ts: Date.now(), block: live.head, ethSpent: r.ethSpent.toString(), tokensBurned: r.tokensBurned.toString(), venue: r.venue, buyTx: r.buyTx, burnTx: r.burnTx, reason, confidence: jev.confidence });
        events.emit('burn');
      }
    } catch (err) {
      console.error('buy and burn failed:', err.shortMessage || err.message);
      decision.outcome = 'failed';
    }
  }
  addDecision(decision);
  live.status = { waited: 'jev says wait', rehearsed: 'rehearsed a burn', burned: 'burned', failed: 'last attempt failed, will retry' }[decision.outcome];
}

async function cycle() {
  const launch = await chain.refreshPhase(live.launch);
  live.head = await chain.provider.getBlockNumber();

  const { total, burned } = await chain.readSupply(launch);
  live.supply = { total: total.toString(), burned: burned.toString(), pct: Number((burned * 1000000n) / chain.INITIAL_SUPPLY) / 10000 };

  const watch = config.watch || chain.wallet?.address;
  if (watch && (await syncBurns(launch, watch, live.head)).length) events.emit('burn');

  live.price = await chain.readPrice(launch);
  if (live.price === null) {
    live.status = 'between venues, graduation in progress';
    return;
  }
  const trades = await chain.readTrades(launch, live.head - 120 * BLOCKS_PER_MIN, live.head);
  live.market = marketStats(trades, live.head, live.price);

  if (live.mode === 'watch') live.status = 'watching the chain';
  else await think(launch);
}

export async function startBot() {
  if (live.mode === 'standby') {
    live.status = 'standby. no token wired';
    return;
  }
  live.launch = await chain.loadLaunch(config.token);
  BLOCKS_PER_MIN = await chain.blocksPerMinute();
  openLedger(live.launch.address);
  console.log(`${config.name}: ${live.mode} on ${config.network}, ${live.launch.symbol} (${live.launch.phase})` + (chain.wallet ? `, furnace ${chain.wallet.address}` : ''));

  const loop = async () => {
    try {
      await cycle();
    } catch (err) {
      console.error('cycle failed:', err.shortMessage || err.message);
      live.status = 'chain unreachable, retrying';
    }
    live.nextLookAt = Date.now() + config.intervalSec * 1000;
    events.emit('update');
    setTimeout(loop, config.intervalSec * 1000);
  };
  await loop();
}

export { ledger };
