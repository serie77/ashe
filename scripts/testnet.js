// the furnace, for real, on robinhood chain testnet.
// pons is not deployed there, so this plants the same token contract pons mints (PonsV2LauncherToken),
// seeds a uniswap v4 pool with it, sells into the pool so there is something to absorb,
// then starts the actual bot + site against it with DRY_RUN off. every transaction is real testnet.
//
//   npm run testnet              set up once (state in data/testnet.json), then run the bot
//   npm run testnet -- --dry     run the whole setup + a buy + a burn through eth_simulateV1, send nothing
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { ethers } from 'ethers';

process.env.CHAIN_ID = '46630';
process.env.RPC_URL = '';
const { config, ADDR } = await import('../src/config.js');
if (!config.privateKey) throw new Error('no furnace wallet. run `npm run wallet` first');

const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
const wallet = new ethers.Wallet(config.privateKey, provider);
const me = wallet.address;
const dry = process.argv.includes('--dry');
const STATE = 'data/testnet.json';

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const POSITION_MANAGER = '0x58daec3116aae6d93017baaea7749052e8a04fa7';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const SUPPLY = 10n ** 27n;
const POOL_ETH = ethers.parseEther('0.004');
const TOKENS_PER_ETH = 650_000_000n; // about where a pons launch trades
const POOL_TOKENS = POOL_ETH * TOKENS_PER_ETH;
const SELL_TOKENS = POOL_TOKENS / 12n;
const NEED = ethers.parseEther('0.006');

const artifact = JSON.parse(readFileSync(new URL('./testnet-token.json', import.meta.url)));
const coder = ethers.AbiCoder.defaultAbiCoder();
const POOL_KEY = 'tuple(address,address,uint24,int24,address)';
const erc20 = new ethers.Interface(['function approve(address,uint256)', 'function transfer(address,uint256)', 'function burn(uint256)', 'function balanceOf(address) view returns (uint256)', 'function totalSupply() view returns (uint256)']);
const permit2 = new ethers.Interface(['function approve(address token, address spender, uint160 amount, uint48 expiration)']);
const posm = new ethers.Interface([`function initializePool(${POOL_KEY} key, uint160 sqrtPriceX96) payable returns (int24)`, 'function modifyLiquidities(bytes unlockData, uint256 deadline) payable', 'function multicall(bytes[] data) payable returns (bytes[])']);
const router = new ethers.Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);

const sqrt = (n) => { let x = n, y = (x + 1n) / 2n; while (y < x) (x = y), (y = (x + n / x) / 2n); return x; };
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);
const MAX160 = 2n ** 160n - 1n;
const FOREVER = 2n ** 48n - 1n;

// every transaction of the setup, in order, for a token that will live at `token`
function setupSteps(token, nonce) {
  const key = [ethers.ZeroAddress, token, 0, 200, ethers.ZeroAddress];
  const sqrtPriceX96 = sqrt(TOKENS_PER_ETH << 192n);
  // full range, so the far ticks contribute nothing measurable: L = eth * sqrtP = tokens / sqrtP
  const liquidity = ((POOL_ETH * sqrtPriceX96) >> 96n) * 999n / 1000n;
  const mint = coder.encode([POOL_KEY, 'int24', 'int24', 'uint256', 'uint128', 'uint128', 'address', 'bytes'], [key, -887200, 887200, liquidity, POOL_ETH, POOL_TOKENS, me, '0x']);
  const unlock = coder.encode(['bytes', 'bytes[]'], ['0x020d14', [mint, coder.encode(['address', 'address'], [key[0], key[1]]), coder.encode(['address', 'address'], [ethers.ZeroAddress, me])]]);
  const sell = coder.encode(['bytes', 'bytes[]'], ['0x060c0f', [
    coder.encode([`tuple(${POOL_KEY},bool,uint128,uint128,uint256,bytes)`], [[key, false, SELL_TOKENS, 0, 0, '0x']]),
    coder.encode(['address', 'uint256'], [token, SELL_TOKENS]),
    coder.encode(['address', 'uint256'], [ethers.ZeroAddress, 0]),
  ]]);
  const ctor = new ethers.Interface(artifact.abi).encodeDeploy(['ashe (testnet)', 'ASHE', '', 'the ashe furnace, rehearsing on testnet', ['', '', '', '', ''], me, me, me, SUPPLY]);
  return [
    { label: 'plant the token (PonsV2LauncherToken, 1B to the furnace)', to: null, data: ethers.concat([artifact.bytecode, ctor]), expect: ethers.getCreateAddress({ from: me, nonce }) },
    { label: 'token: approve permit2', to: token, data: erc20.encodeFunctionData('approve', [PERMIT2, ethers.MaxUint256]) },
    { label: 'permit2: allow the position manager', to: PERMIT2, data: permit2.encodeFunctionData('approve', [token, POSITION_MANAGER, MAX160, FOREVER]) },
    { label: 'permit2: allow the universal router', to: PERMIT2, data: permit2.encodeFunctionData('approve', [token, ADDR.universalRouter, MAX160, FOREVER]) },
    { label: `open the v4 pool and seed it (${ethers.formatEther(POOL_ETH)} ETH + ${POOL_TOKENS / 10n ** 18n} ASHE)`, to: POSITION_MANAGER, value: POOL_ETH, data: posm.encodeFunctionData('multicall', [[posm.encodeFunctionData('initializePool', [key, sqrtPriceX96]), posm.encodeFunctionData('modifyLiquidities', [unlock, deadline()])]]) },
    { label: `sell ${SELL_TOKENS / 10n ** 18n} ASHE into the pool, so there is pressure to absorb`, to: ADDR.universalRouter, data: router.encodeFunctionData('execute', ['0x10', [sell], deadline()]) },
    { label: 'park the rest of the supply at 0x…dEaD so the furnace holds nothing', to: token, data: erc20.encodeFunctionData('transfer', [DEAD, SUPPLY - POOL_TOKENS - SELL_TOKENS]) },
  ];
}

async function rehearse() {
  const nonce = await provider.getTransactionCount(me);
  const token = ethers.getCreateAddress({ from: me, nonce });
  process.env.PRIVATE_KEY = config.privateKey;
  const chain = await import('../src/chain.js');
  const steps = setupSteps(token, nonce);
  const launch = { address: token, phase: 'v4', curve: null, poolKey: [ethers.ZeroAddress, token, 0n, 200n, ethers.ZeroAddress] };
  const buyWei = ethers.parseEther('0.0003');
  const burnAmount = 100_000n * 10n ** 18n;
  steps.push({ label: "the bot's own buy calldata (0.0003 ETH)", ...chain.buildBuyTx(launch, buyWei, 1n) });
  steps.push({ label: 'read what the buy delivered', to: token, data: erc20.encodeFunctionData('balanceOf', [me]), read: true });
  steps.push({ label: 'burn', to: token, data: erc20.encodeFunctionData('burn', [burnAmount]) });
  steps.push({ label: 'read total supply', to: token, data: erc20.encodeFunctionData('totalSupply'), read: true });

  const [block] = await provider.send('eth_simulateV1', [{
    blockStateCalls: [{
      stateOverrides: { [me]: { balance: ethers.toQuantity(ethers.parseEther('1')) } },
      calls: steps.map((s) => ({ from: me, ...(s.to ? { to: s.to } : {}), data: s.data, value: ethers.toQuantity(s.value ?? 0n) })),
    }],
  }, 'latest']);
  let gas = 0n;
  block.calls.forEach((c, i) => {
    gas += BigInt(c.gasUsed);
    const extra = steps[i].read ? ` -> ${Number(BigInt(c.returnData) / 10n ** 18n).toLocaleString()}` : '';
    console.log(`  ${c.status === '0x1' ? 'ok  ' : 'FAIL'}  ${steps[i].label}${extra}${c.status === '0x1' ? '' : '  ' + (c.error?.message ?? '')}`);
  });
  const ok = block.calls.every((c) => c.status === '0x1');
  const supplyAfter = BigInt(block.calls.at(-1).returnData);
  console.log(ok && supplyAfter === SUPPLY - burnAmount ? `\nrehearsal passed. total gas ${gas.toLocaleString()}, supply fell by exactly the burn.` : '\nrehearsal FAILED');
  process.exit(ok ? 0 : 1);
}

async function setup() {
  const balance = await provider.getBalance(me);
  console.log(`furnace ${me} holds ${ethers.formatEther(balance)} testnet ETH`);
  if (balance < NEED) {
    console.log(`needs at least ${ethers.formatEther(NEED)}. send testnet ETH to the furnace, then run this again.`);
    process.exit(1);
  }
  const nonce = await provider.getTransactionCount(me);
  const token = ethers.getCreateAddress({ from: me, nonce });
  for (const step of setupSteps(token, nonce)) {
    const tx = { to: step.to, data: step.data, value: step.value ?? 0n };
    const gas = await wallet.estimateGas(tx);
    const rc = await (await wallet.sendTransaction({ ...tx, gasLimit: (gas * 3n) / 2n })).wait();
    if (rc.status !== 1) throw new Error(`reverted: ${step.label}`);
    console.log(`  ok  ${step.label}\n      ${config.explorer}/tx/${rc.hash}`);
  }
  mkdirSync('data', { recursive: true });
  writeFileSync(STATE, JSON.stringify({ token }));
  return token;
}

if (dry) await rehearse();

const token = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')).token : await setup();
console.log(`\ntoken ${token}\nstarting the furnace on testnet, live.\n`);

// the bot reads its settings at import, so it gets its own process with the testnet settings in place
const bot = spawn(process.execPath, ['src/index.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: process.env.PORT || '3001', TOKEN_ADDRESS: token, WATCH_ADDRESS: '', DRY_RUN: '0', DATA_DIR: 'data/testnet', INTERVAL_SEC: '20', MIN_BUY_ETH: '0.0001', MAX_BUY_ETH: '0.0003', MAX_IDLE_MIN: '2' },
});
bot.on('exit', (code) => process.exit(code ?? 0));
