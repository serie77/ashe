import { readFileSync, existsSync } from 'node:fs';

// minimal .env loader, no dependency
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const num = (k, d) => (env[k] !== undefined && env[k] !== '' ? Number(env[k]) : d);

const NETWORKS = {
  4663: { network: 'mainnet', rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' },
  46630: { network: 'testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', explorer: 'https://explorer.testnet.chain.robinhood.com' },
};
const chainId = num('CHAIN_ID', 4663);
const net = NETWORKS[chainId];

export const config = {
  name: 'ashe',
  port: num('PORT', 3000),
  chainId,
  network: net.network,
  rpcUrl: env.RPC_URL || net.rpc,
  explorer: net.explorer,
  // pons only exists on mainnet. on testnet the token trades in a bare uniswap v4 pool and there are no fees to claim.
  pons: chainId === 4663,

  jevKey: env.JEV_API_KEY || '',
  token: env.TOKEN_ADDRESS || '',
  privateKey: env.PRIVATE_KEY || '',
  // address whose burns are shown on the site. defaults to the furnace wallet.
  watch: env.WATCH_ADDRESS || '',

  dryRun: env.DRY_RUN !== '0',
  dryBudgetEth: num('DRY_RUN_BUDGET_ETH', 0.05),

  intervalSec: num('INTERVAL_SEC', 60),
  minBuyEth: num('MIN_BUY_ETH', 0.0005),
  maxBuyEth: num('MAX_BUY_ETH', 0.2),
  gasReserveEth: num('GAS_RESERVE_ETH', 0.0003),
  slippageBps: num('SLIPPAGE_BPS', 300),
  minConfidence: num('MIN_CONFIDENCE', 0.55),
  feeKeepBps: num('FEE_KEEP_BPS', 4000), // share of creator fees left in the pons escrow, never claimed by the bot
  maxIdleMin: num('MAX_IDLE_MIN', 5), // hard cap: never more than this many minutes without a buyback and burn

  dataDir: env.DATA_DIR || 'data',
};

// pons v2 + uniswap v4 on robinhood chain. the uniswap addresses are the same on testnet.
export const ADDR = {
  factory: '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',
  hook: '0xe5e702641ea86f4ae6cc3cdaed2b886f976be044',
  feeEscrow: '0xd3afeb2a57f70ef218aa82451c51b2fb0416ac9e',
  poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
  universalRouter: '0x8876789976decbfcbbbe364623c63652db8c0904',
  quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
  stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
};
