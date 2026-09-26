// proves the furnace end to end against the live chain without spending anything.
// every transaction the bot would send is run through eth_simulateV1 on real state, from a wallet given pretend ETH.
import { ethers } from 'ethers';
import { config, ADDR } from '../src/config.js';

process.env.DRY_RUN = '1';
if (!config.privateKey) process.env.PRIVATE_KEY = ethers.Wallet.createRandom().privateKey;
const chain = await import('../src/chain.js');
const { askJev } = await import('../src/jev.js');
const me = (chain.wallet ?? new ethers.Wallet(process.env.PRIVATE_KEY)).address;

const UNDERHOOD = '0x8e391e95463d7d4eec93c34507781a317b4c0ae2';
const token = new ethers.Interface(['function burn(uint256)', 'function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)']);
let failed = 0;
const check = async (label, fn) => {
  try {
    console.log(`  ok    ${label}: ${await fn()}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${label}: ${err.shortMessage || err.message}`);
  }
};

// buy, then burn what arrived, then read supply: three calls in one simulated block
async function rehearse(launch, amountWei) {
  const expected = await chain.quoteBuy(launch, amountWei);
  const minOut = (expected * 97n) / 100n;
  const buy = chain.buildBuyTx(launch, amountWei, minOut);
  const call = (to, data, value = 0n) => ({ from: me, to, data, value: ethers.toQuantity(value) });
  const [block] = await chain.provider.send('eth_simulateV1', [
    {
      blockStateCalls: [
        {
          stateOverrides: { [me]: { balance: ethers.toQuantity(ethers.parseEther('10')) } },
          calls: [
            call(launch.address, token.encodeFunctionData('totalSupply')),
            call(buy.to, buy.data, amountWei),
            call(launch.address, token.encodeFunctionData('balanceOf', [me])),
            call(launch.address, token.encodeFunctionData('burn', [minOut])),
            call(launch.address, token.encodeFunctionData('totalSupply')),
          ],
        },
      ],
    },
    'latest',
  ]);
  const bad = block.calls.findIndex((c) => c.status !== '0x1');
  if (bad !== -1) throw new Error(`simulated call ${bad} reverted`);
  const [before, , got, , after] = block.calls.map((c) => (c.returnData === '0x' ? 0n : BigInt(c.returnData)));
  if (before - after !== minOut) throw new Error('supply did not drop by the burned amount');
  return `${ethers.formatEther(amountWei)} ETH bought ${Number(got / 10n ** 18n).toLocaleString()} tokens, burn cut total supply by ${Number((before - after) / 10n ** 18n).toLocaleString()}`;
}

console.log('chain');
await check('robinhood chain rpc', async () => `chain id ${(await chain.provider.getNetwork()).chainId}, block ${await chain.provider.getBlockNumber()}`);

console.log('jev');
await check('openjev answers', async () => {
  const j = await askJev({ market: { price_change_15m_pct: -9, vs_2h_high_pct: -20, last_15m: { buys_eth: 0.01, sells_eth: 0.3, trades: 9 } }, furnace: { budget_eth: 0.05, minutes_since_last_buyback: 30 } });
  return `${j.choice} @ ${j.confidence}, size ${j.size}, sell pressure ${j.sellPressure}`;
});

console.log('uniswap v4 venue (graduated token)');
const v4 = await chain.loadLaunch(UNDERHOOD);
await check(`${v4.symbol} is ${v4.phase}`, async () => `price ${await chain.readPrice(v4)} ETH`);
await check('buy then burn', () => rehearse(v4, ethers.parseEther('0.01')));

console.log('pons bonding curve venue (token still on its curve)');
const head = await chain.provider.getBlockNumber();
const launched = await chain.provider.send('eth_getLogs', [
  { address: ADDR.factory, topics: ['0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607'], fromBlock: ethers.toQuantity(head - 40000), toBlock: ethers.toQuantity(head - 3000) },
]);
let curve = null;
for (const log of launched.reverse()) {
  const l = await chain.loadLaunch('0x' + log.topics[1].slice(26)).catch(() => null);
  if (l?.phase === 'curve') { curve = l; break; }
}
if (!curve) console.log('  skip  no ETH launch on its curve in the last hour');
else {
  await check(`${curve.symbol} is ${curve.phase}`, async () => `price ${await chain.readPrice(curve)} ETH`);
  await check('buy then burn', () => rehearse(curve, ethers.parseEther('0.01')));
}

if (config.token && config.token.toLowerCase() !== UNDERHOOD) {
  console.log('your token');
  const mine = await chain.loadLaunch(config.token);
  await check(`${mine.symbol} is ${mine.phase}`, async () => `price ${await chain.readPrice(mine)} ETH`);
  await check('buy then burn', () => rehearse(mine, ethers.parseEther(String(config.minBuyEth))));
  await check('furnace receives the creator fees', async () => {
    if (mine.creatorFeeRecipient.toLowerCase() !== me.toLowerCase()) throw new Error(`fees go to ${mine.creatorFeeRecipient}, not the furnace ${me}`);
    return me;
  });
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
