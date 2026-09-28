import { EventEmitter } from 'node:events';
import { ethers } from 'ethers';
import { config } from './config.js';
import * as chain from './chain.js';
import { askJev } from './jev.js';
import { ledger, openLedger, addBurn, addDecision, syncBurns, setKept } from './ledger.js';

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
  // what the furnace is doing right now, pushed to the site the moment it changes
  phase: { name: 'idle', at: 0 },
  nextLookAt: 0,
};

let BLOCKS_PER_MIN = 600;

// the rulebook. the site prints these, so what it says jev does is what the code does.
export const RULES = {
  intervalSec: config.intervalSec,
  minConfidence: config.minConfidence,
  chasingMax: 0.7, // never buy when jev's "chasing a pump" read is at or above this
  sizeMin: 0.3, // share of the budget for jev's smallest size
  sizeMax: 0.8, // and for its largest
  heartbeatFrac: 0.4,
  maxIdleMin: config.maxIdleMin,
  minBuyEth: config.minBuyEth,
  maxBuyEth: config.maxBuyEth,
  slippageBps: config.slippageBps,
};
const PHASE_TEXT = { reading: 'reading the chain', asking: 'jev is thinking', buying: 'buying', burning: 'burning', idle: '' };
function phase(name, extra = {}) {
  live.phase = { name, at: Date.now(), ...extra };
  if (PHASE_TEXT[name]) live.status = PHASE_TEXT[name];
  events.emit('phase');
}

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
  const fees = await chain.collectFees(launch, minWei, BigInt(ledger.kept || '0'));
  if (fees.kept.toString() !== (ledger.kept || '0')) setKept(fees.kept);
  if (fees.claimed) console.log(`claimed ${eth(fees.claimed)} ETH of creator fees · ${eth(fees.kept)} ETH left in the escrow`);
  const leftover = await chain.burnLeftovers(launch);
  if (leftover) {
    console.log(`burned ${eth(leftover.tokensBurned)} ${launch.symbol} already in the wallet · ${config.explorer}/tx/${leftover.burnTx}`);
    addBurn({ ts: Date.now(), block: live.head, ethSpent: '0', tokensBurned: leftover.tokensBurned.toString(), venue: null, buyTx: null, burnTx: leftover.burnTx, reason: 'sweep' });
    events.emit('burn');
  }

  live.furnace = await chain.readFurnace();
  const budget = config.dryRun ? config.dryBudgetEth : Math.max(0, eth(live.furnace.balance) - config.gasReserveEth);
  if (budget < config.minBuyEth) {
    live.status = 'waiting for fees';
    console.log(`waiting for fees · ${round(budget, 6)} ETH spendable, needs ${config.minBuyEth}`);
    return;
  }

  const idleMin = Math.floor((Date.now() - lastActionTs) / 60000);
  const state = {
    token: { symbol: launch.symbol, venue: launch.phase === 'curve' ? 'bonding curve' : 'uniswap v4 pool', supply_burned_pct: live.supply.pct },
    market: live.market,
    furnace: { budget_eth: round(budget, 5), minutes_since_last_buyback: idleMin },
  };
  phase('asking', { market: live.market, budgetEth: round(budget, 5) });
  const jev = await askJev(state);

  const chasing = jev.chasing >= RULES.chasingMax;
  let reason = null;
  if (jev.choice === 'buy_now' && jev.confidence >= config.minConfidence && !chasing) reason = 'jev';
  else if (idleMin >= config.maxIdleMin) reason = 'heartbeat'; // the cap holds even into a pump

  const decision = { ts: Date.now(), ...jev, market: live.market, budgetEth: round(budget, 5), idleMin, outcome: 'waited', reason };
  phase('decided', { ts: decision.ts, jev, reason });
  if (reason) {
    const size = Math.min(2, Math.max(0, jev.size));
    const frac = reason === 'jev' ? RULES.sizeMin + ((RULES.sizeMax - RULES.sizeMin) * size) / 2 : RULES.heartbeatFrac;
    decision.frac = round(frac, 3);
    const amountEth = Math.min(Math.max(budget * frac, config.minBuyEth), config.maxBuyEth, budget);
    const amountWei = ethers.parseEther(amountEth.toFixed(18));
    try {
      const r = await chain.buyAndBurn(launch, amountWei, (step) => phase(step, { amountEth: round(eth(amountWei), 6) }));
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
  const said = `jev: ${jev.choice === 'buy_now' ? 'buy' : 'wait'} @ ${jev.confidence.toFixed(2)}, chasing ${jev.chasing.toFixed(2)}`;
  if (decision.outcome === 'burned') console.log(`${said} · bought and burned ${decision.tokens} ${launch.symbol} for ${decision.amountEth} ETH · ${config.explorer}/tx/${decision.burnTx}`);
  else if (decision.outcome === 'rehearsed') console.log(`${said} · rehearsed a ${decision.amountEth} ETH buy, nothing sent`);
  else if (decision.outcome === 'failed') console.log(`${said} · buy failed, retrying next cycle`);
  else console.log(`${said} · held · budget ${round(budget, 6)} ETH · heartbeat in ${Math.max(0, config.maxIdleMin - idleMin)} min`);
  live.status = { waited: 'jev says wait', rehearsed: 'rehearsed a burn', burned: 'burned', failed: 'last attempt failed, will retry' }[decision.outcome];
}

async function cycle() {
  phase('reading');
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
  if (chain.wallet && live.launch.creatorFeeRecipient && live.launch.creatorFeeRecipient.toLowerCase() !== chain.wallet.address.toLowerCase())
    console.log(`${config.name}: creator fees go to ${live.launch.creatorFeeRecipient}, not the furnace. nothing will be claimed until that wallet calls transferCreatorFeeRecipient(${live.launch.address}, ${chain.wallet.address}) on the pons factory.`);
  console.log(`${config.name}: ${live.mode} on ${config.network}, ${live.launch.symbol} (${live.launch.phase})` + (chain.wallet ? `, furnace ${chain.wallet.address}` : ''));

  const loop = async () => {
    try {
      await cycle();
    } catch (err) {
      console.error('cycle failed:', err.shortMessage || err.message);
      live.status = 'chain unreachable, retrying';
    }
    live.phase = { name: 'idle', at: Date.now() };
    live.nextLookAt = Date.now() + config.intervalSec * 1000;
    events.emit('update');
    setTimeout(loop, config.intervalSec * 1000);
  };
  await loop();
}

export { ledger };
