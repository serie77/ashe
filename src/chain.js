import { ethers } from 'ethers';
import { config, ADDR } from './config.js';

export const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
export const wallet = config.privateKey ? new ethers.Wallet(config.privateKey, provider) : null;

const ZERO = ethers.ZeroAddress;
const coder = ethers.AbiCoder.defaultAbiCoder();
export const INITIAL_SUPPLY = 10n ** 27n; // every pons launch mints 1,000,000,000 * 1e18

const POOL_KEY = 'tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)';

const abi = {
  token: [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function burn(uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ],
  factory: [
    'function getLaunchFeePolicy(address token) view returns (tuple(address protocolFeeRecipient, uint16 protocolFeeShareBps, uint16 buybackBurnBps, uint16 hookFeeBps, uint16 maxInternalPriceImpactBps))',
    'function getLaunchedToken(address token) view returns (tuple(address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))',
  ],
  curve: [
    'function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)',
    'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
    'function realQuoteReserve() view returns (uint256)',
    'function creatorTaxBalance() view returns (uint256)',
    'function feeBps() view returns (uint256)',
    'function sweepFees(uint256 minBuybackTokensOut)',
    'event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)',
    'event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)',
  ],
  escrow: ['function balanceOf(address) view returns (uint256)', 'function claim() returns (uint256)'],
  hook: [
    'function pendingCreatorTax(bytes32 poolId, address currency) view returns (uint256)',
    'function sweepPoolFees(bytes32 poolId, uint256 minConversionQuoteOut, uint256 minBuybackTokensOut)',
  ],
  poolManager: [
    'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
  ],
  stateView: ['function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)'],
  quoter: [
    `function quoteExactInputSingle(tuple(${POOL_KEY} poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)`,
  ],
  router: ['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'],
};

const iface = Object.fromEntries(Object.entries(abi).map(([k, v]) => [k, new ethers.Interface(v)]));
const contract = (addr, key, runner = provider) => new ethers.Contract(addr, abi[key], runner);

export const PHASE = ['curve', 'swept', 'v4', 'rescued'];

export async function loadLaunch(tokenAddr) {
  const token = contract(tokenAddr, 'token');
  if (!config.pons) {
    const [name, symbol] = await Promise.all([token.name(), token.symbol()]);
    const poolKey = [ZERO, tokenAddr, 0n, 200n, ZERO];
    const poolId = ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], poolKey));
    return { address: ethers.getAddress(tokenAddr), name, symbol, curve: null, creatorFeeRecipient: null, creatorTaxBps: 0, fees: null, phase: 'v4', poolKey, poolId };
  }
  const [name, symbol, l] = await Promise.all([
    token.name(),
    token.symbol(),
    contract(ADDR.factory, 'factory').getLaunchedToken(tokenAddr),
  ]);
  if (!l.exists) throw new Error('token was not launched on pons v2');
  if (l.pairToken !== ZERO) throw new Error('only ETH-quoted launches are supported');
  // how pons splits this launch's fees. frozen at launch, so it is read once.
  const [policy, curveFeeBps] = await Promise.all([contract(ADDR.factory, 'factory').getLaunchFeePolicy(tokenAddr), contract(l.curve, 'curve').feeBps()]);
  const poolKey = [ZERO, tokenAddr, l.poolFee, l.tickSpacing, ADDR.hook];
  const poolId = ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], poolKey));
  return {
    address: ethers.getAddress(tokenAddr),
    name,
    symbol,
    curve: l.curve,
    creatorFeeRecipient: l.creatorFeeRecipient,
    creatorTaxBps: Number(l.creatorTaxBps),
    fees: {
      curveFeeBps: Number(curveFeeBps),
      poolFeeBps: Number(policy.hookFeeBps),
      ponsShareBps: Number(policy.protocolFeeShareBps), // pons's cut of the trade fee. the rest is the creator's
      lockShareBps: l.buybackEnabled ? Number(policy.buybackBurnBps) : 0, // pons's own buyback-and-lock, if the creator switched it on
      creatorTaxBps: Number(l.creatorTaxBps),
    },
    graduationThreshold: l.graduationThreshold,
    phase: PHASE[Number(l.phase)],
    poolKey,
    poolId,
  };
}

// the phase can change under us (graduation), so it is re-read every cycle
export async function refreshPhase(launch) {
  if (!config.pons) return launch;
  const l = await contract(ADDR.factory, 'factory').getLaunchedToken(launch.address);
  launch.phase = PHASE[Number(l.phase)];
  launch.creatorFeeRecipient = l.creatorFeeRecipient;
  return launch;
}

export async function readSupply(launch) {
  const total = await contract(launch.address, 'token').totalSupply();
  return { total, burned: INITIAL_SUPPLY - total };
}

const Q192 = 2n ** 192n;
// ETH is currency0, so sqrtPrice^2 is tokens per ETH. returns ETH per whole token as a float.
const priceFromSqrt = (sqrtP) => Number((Q192 * 10n ** 18n) / (sqrtP * sqrtP)) / 1e18;

export async function readPrice(launch) {
  if (launch.phase === 'curve') {
    const [q, t] = await contract(launch.curve, 'curve').getReserves();
    return Number((q * 10n ** 18n) / t) / 1e18;
  }
  if (launch.phase === 'v4') {
    const s = await contract(ADDR.stateView, 'stateView').getSlot0(launch.poolId);
    return priceFromSqrt(s.sqrtPriceX96);
  }
  return null;
}

// trades on whichever venue is live, oldest first: { block, side, eth, tokens, price }
export async function readTrades(launch, fromBlock, toBlock) {
  const range = { fromBlock: ethers.toQuantity(fromBlock), toBlock: ethers.toQuantity(toBlock) };
  if (launch.phase === 'curve') {
    const buyT = iface.curve.getEvent('CurveBuy').topicHash;
    const sellT = iface.curve.getEvent('CurveSell').topicHash;
    const logs = await provider.send('eth_getLogs', [{ address: launch.curve, topics: [[buyT, sellT]], ...range }]);
    return logs.map((log) => {
      const e = iface.curve.parseLog(log);
      const buy = e.name === 'CurveBuy';
      const eth = Number(buy ? e.args.quoteIn : e.args.quoteOut) / 1e18;
      const tokens = Number(buy ? e.args.tokensOut : e.args.tokensIn) / 1e18;
      return { block: Number(log.blockNumber), side: buy ? 'buy' : 'sell', eth, tokens, price: tokens ? eth / tokens : 0 };
    });
  }
  if (launch.phase === 'v4') {
    const swapT = iface.poolManager.getEvent('Swap').topicHash;
    const logs = await provider.send('eth_getLogs', [{ address: ADDR.poolManager, topics: [swapT, launch.poolId], ...range }]);
    return logs.map((log) => {
      const e = iface.poolManager.parseLog(log);
      const a0 = e.args.amount0;
      const a1 = e.args.amount1;
      return {
        block: Number(log.blockNumber),
        side: a0 < 0n ? 'buy' : 'sell', // swapper paid ETH in
        eth: Number(a0 < 0n ? -a0 : a0) / 1e18,
        tokens: Number(a1 < 0n ? -a1 : a1) / 1e18,
        price: priceFromSqrt(e.args.sqrtPriceX96),
      };
    });
  }
  return [];
}

// burns of the token by `from`, oldest first
export async function readBurnLogs(launch, from, fromBlock, toBlock) {
  const t = iface.token.getEvent('Transfer').topicHash;
  const logs = await provider.send('eth_getLogs', [
    {
      address: launch.address,
      topics: [t, ethers.zeroPadValue(from, 32), ethers.zeroPadValue(ZERO, 32)],
      fromBlock: ethers.toQuantity(fromBlock),
      toBlock: ethers.toQuantity(toBlock),
    },
  ]);
  return logs.map((log) => ({ block: Number(log.blockNumber), tx: log.transactionHash, tokens: BigInt(log.data) }));
}

// ETH that went into the buy inside a given transaction, if it contained one
export async function ethSpentInTx(launch, txHash) {
  const rc = await provider.getTransactionReceipt(txHash);
  let spent = 0n;
  let venue = null;
  for (const log of rc?.logs ?? []) {
    const addr = log.address.toLowerCase();
    if (addr === ADDR.poolManager && log.topics[1] === launch.poolId) {
      const e = iface.poolManager.parseLog(log);
      if (e?.name === 'Swap' && e.args.amount0 < 0n) (spent += -e.args.amount0), (venue = 'v4');
    } else if (addr === launch.curve?.toLowerCase()) {
      const e = iface.curve.parseLog(log);
      if (e?.name === 'CurveBuy') (spent += e.args.quoteIn), (venue = 'curve');
    }
  }
  return { spent, venue };
}

export async function readFurnace() {
  return wallet ? { balance: await provider.getBalance(wallet.address) } : null;
}

// block time differs per network (~0.1s mainnet, ~0.25s testnet), and the trade windows are counted in blocks
export async function blocksPerMinute() {
  const head = await provider.getBlock('latest');
  const past = await provider.getBlock(head.number - 5000);
  return Math.round((5000 / (head.timestamp - past.timestamp)) * 60);
}

// --- writes ---------------------------------------------------------------

const DRY_FUNDS = { balance: ethers.toQuantity(ethers.parseEther('100')) };

// eth_call as the furnace. in dry run the wallet is given pretend ETH so an unfunded key can rehearse.
async function simulate(tx) {
  const call = { from: wallet.address, to: tx.to, data: tx.data, value: ethers.toQuantity(tx.value ?? 0n) };
  const overrides = config.dryRun ? [{ [wallet.address]: DRY_FUNDS }] : [];
  return provider.send('eth_call', [call, 'latest', ...overrides]);
}

async function send(tx) {
  const gas = await wallet.estimateGas(tx);
  const sent = await wallet.sendTransaction({ ...tx, gasLimit: (gas * 3n) / 2n });
  const rc = await sent.wait();
  if (rc.status !== 1) throw new Error('transaction reverted');
  return rc;
}

// pull creator fees toward the wallet: sweep the venue if we are allowed to, then claim the escrow.
export async function collectFees(launch, minWei) {
  if (config.dryRun || !config.pons) return 0n;
  try {
    if (launch.phase === 'curve') {
      const curve = contract(launch.curve, 'curve', wallet);
      if ((await curve.creatorTaxBalance()) >= minWei) {
        await curve.sweepFees.staticCall(0n);
        await send({ to: launch.curve, data: iface.curve.encodeFunctionData('sweepFees', [0n]) });
      }
    } else if (launch.phase === 'v4') {
      const hook = contract(ADDR.hook, 'hook', wallet);
      if ((await hook.pendingCreatorTax(launch.poolId, ZERO)) >= minWei) {
        await hook.sweepPoolFees.staticCall(launch.poolId, 0n, 0n);
        await send({ to: ADDR.hook, data: iface.hook.encodeFunctionData('sweepPoolFees', [launch.poolId, 0n, 0n]) });
      }
    }
  } catch {
    // the sweep needs the pons operator right now (a buyback leg is pending). it will come through the escrow later.
  }
  const escrow = contract(ADDR.feeEscrow, 'escrow', wallet);
  const claimable = await escrow.balanceOf(wallet.address);
  if (claimable < minWei) return 0n;
  await send({ to: ADDR.feeEscrow, data: iface.escrow.encodeFunctionData('claim', []) });
  return claimable;
}

export async function quoteBuy(launch, amountWei) {
  if (launch.phase === 'curve') {
    const data = iface.curve.encodeFunctionData('buy', [amountWei, 1n, wallet.address]);
    const out = await simulate({ to: launch.curve, data, value: amountWei });
    return iface.curve.decodeFunctionResult('buy', out)[0];
  }
  const q = await contract(ADDR.quoter, 'quoter').quoteExactInputSingle.staticCall([launch.poolKey, true, amountWei, '0x']);
  return q.amountOut;
}

export function buildBuyTx(launch, amountWei, minOut) {
  if (launch.phase === 'curve') {
    return { to: launch.curve, value: amountWei, data: iface.curve.encodeFunctionData('buy', [amountWei, minOut, wallet.address]) };
  }
  // universal router 2.1.x: V4_SWAP -> SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
  const swap = coder.encode(
    [`tuple(${POOL_KEY} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, uint256 minHopPriceX36, bytes hookData)`],
    [[launch.poolKey, true, amountWei, minOut, 0n, '0x']],
  );
  const settle = coder.encode(['address', 'uint256'], [ZERO, amountWei]);
  const take = coder.encode(['address', 'uint256'], [launch.address, minOut]);
  const input = coder.encode(['bytes', 'bytes[]'], ['0x060c0f', [swap, settle, take]]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  return { to: ADDR.universalRouter, value: amountWei, data: iface.router.encodeFunctionData('execute', ['0x10', [input], deadline]) };
}

// buy then burn. returns what happened, in wei.
export async function buyAndBurn(launch, amountWei) {
  const expected = await quoteBuy(launch, amountWei);
  const minOut = (expected * BigInt(10000 - config.slippageBps)) / 10000n;
  const tx = buildBuyTx(launch, amountWei, minOut);
  const venue = launch.phase;

  if (config.dryRun) {
    await simulate(tx); // throws if the real thing would revert
    return { venue, ethSpent: amountWei, tokensBurned: expected, buyTx: null, burnTx: null };
  }

  const buyRc = await send(tx);
  const { spent } = await ethSpentInTx(launch, buyRc.hash);
  const held = await contract(launch.address, 'token').balanceOf(wallet.address);
  const burnRc = await send({ to: launch.address, data: iface.token.encodeFunctionData('burn', [held]) });
  return { venue, ethSpent: spent || amountWei, tokensBurned: held, buyTx: buyRc.hash, burnTx: burnRc.hash };
}

// anything left in the wallet from an interrupted cycle gets burned on the next one
export async function burnLeftovers(launch) {
  if (config.dryRun) return null;
  const held = await contract(launch.address, 'token').balanceOf(wallet.address);
  if (held === 0n) return null;
  const rc = await send({ to: launch.address, data: iface.token.encodeFunctionData('burn', [held]) });
  return { tokensBurned: held, burnTx: rc.hash };
}
