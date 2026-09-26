# ashe

an ash tree on robinhood chain that buys itself back and burns. jev decides when.

One Node process: the furnace (bot) and the site. No build step.

```
npm install
npm start          # http://localhost:3000
npm run verify     # proves buy -> burn on both venues against live mainnet state, spends nothing
npm run testnet    # the real thing on robinhood testnet: real transactions, real burns (see below)
```

## How it works

Every `INTERVAL_SEC` the furnace:

1. sweeps and claims the token's pons creator fees into its wallet
2. reads price + the last 2h of trades from chain (bonding curve before graduation, uniswap v4 pool after)
3. sends that to [OpenJev](https://openjev.sh) with four typed questions: buy or wait (choice), how big (score), sell pressure (noul), chasing a pump (noul)
4. buys only if jev says `buy_now` with confidence >= `MIN_CONFIDENCE` and it is not chasing. jev's size score picks 15-60% of the budget, clamped to `MIN_BUY_ETH`..`MAX_BUY_ETH`. If nothing happened for `MAX_IDLE_MIN`, a small heartbeat buy goes through anyway
5. burns everything it bought with the token's own `burn()`. Total supply drops on chain

The site streams all of it: the tree's crown burns in proportion to supply burned, new burns flare the tree and ignite a ledger row. Ashe is the moth in the tree: she rests while jev waits, comes to a warm pointer, and flies to the fire when jev buys. The rulebook on the site is printed from `RULES` in `src/bot.js`, so what it says is what the code does.

## Going live with your token

1. `npm run wallet` mints the furnace wallet into `.env` (already done, address is printed on start). Back up `.env`.
2. Launch ASHE on pons with an ETH pair and a creator tax, and leave pons's own **buyback-and-lock switched off** (it would divert half of the furnace's share of the trade fee into a 5-year lock instead of the burn). Either launch it **from the furnace wallet** (import its key into your browser wallet), or launch from any wallet and call `transferCreatorFeeRecipient(token, furnaceAddress)` on the pons factory.
3. In `.env`: set `TOKEN_ADDRESS`, delete `WATCH_ADDRESS`, keep `DRY_RUN=1`.
4. `npm run verify` — it now also rehearses your token and checks the fees point at the furnace.
5. Send the furnace a little ETH for gas, set `DRY_RUN=0`, `npm start`.

Until then `.env` points at underhood read-only, so the site shows its real 107 burns while jev rehearses against its live pool.

## How pons fees reach the furnace

Read from chain per launch (`getLaunchFeePolicy`), and printed on the site from those numbers:

- every trade pays a **1% trade fee**. pons keeps 30% of it, the creator side gets 70%
- plus the **creator tax** chosen at launch (0-10%), which goes to the creator in full
- fees sit in the curve (before graduation) or the v4 hook (after), get swept into the pons fee escrow, and the creator fee recipient claims them. For ashe that recipient is the furnace wallet, and it is the furnace's only budget

With a 2% tax that is 2.7% of every trade to the furnace and 0.3% to pons.

## Testnet

Pons is not deployed on Robinhood Chain testnet (46630); Uniswap v4 is, at the mainnet addresses. So `npm run testnet`:

1. deploys the same token contract pons mints (`PonsV2LauncherToken`, compiled from their repo, in `scripts/testnet-token.json`)
2. opens a hookless v4 pool with 0.004 ETH of liquidity, sells into it so there is pressure to absorb, parks the rest of the supply at `0x…dEaD`
3. starts the real bot + site against it with `DRY_RUN=0`: jev decides, the furnace buys through the universal router and burns, the site shows it with testnet explorer links

Send ~0.01 testnet ETH to the furnace wallet first. `npm run testnet -- --dry` runs the whole sequence through `eth_simulateV1` without sending anything. Setup happens once (state in `data/testnet.json`); later runs go straight to the bot. What testnet cannot cover is pons itself: the bonding-curve venue and fee sweep/claim are only exercised by `npm run verify` against mainnet state.

## Modes

| mode | when | what it does |
|---|---|---|
| standby | no `TOKEN_ADDRESS` | site only |
| watch | no `PRIVATE_KEY` or no `JEV_API_KEY` | reads the chain, no jev, no trades |
| rehearsal | `DRY_RUN=1` | real jev calls, every buy simulated via `eth_call`, nothing sent |
| live | `DRY_RUN=0` | trades |

## Settings (.env)

`JEV_API_KEY` `TOKEN_ADDRESS` `PRIVATE_KEY` `WATCH_ADDRESS` `DRY_RUN` `CHAIN_ID` `RPC_URL` `PORT` `DATA_DIR`
`INTERVAL_SEC=60` `MIN_BUY_ETH=0.0005` `MAX_BUY_ETH=0.05` `GAS_RESERVE_ETH=0.0003` `SLIPPAGE_BPS=300` `MIN_CONFIDENCE=0.55` `MAX_IDLE_MIN=45`

## Railway

Start command is `npm start`. Set the `.env` values as service variables. Mount a volume and point `DATA_DIR` at it: burns re-sync from chain on a fresh disk, but jev's decision history and the ETH-spent figures live in the ledger file.

## Layout

```
src/chain.js    pons + uniswap v4 reads, buy, burn, fee claim
src/jev.js      the four questions
src/bot.js      the loop and the decision rule
src/ledger.js   burn + decision history, re-syncs burns from chain
src/server.js   static site, /api/state, /api/stream (SSE)
public/         the site. tree.js the canvas tree, moth.js ashe herself, flow.js the live jev diagram, motion.js the anime.js scroll + pointer layer
brand/          the coin image (ashe-coin-1024/512.png), the wing-beat gif, the x banner (ashe-banner*.png; `node brand/banner.mjs` re-renders it from banner.html), and the launch animation (ashe-burn.gif; `node brand/tweet.mjs`, which also writes a 1080p mp4 if ffmpeg is installed). the drawing itself is public/mothart.js, shared by the hero moth and the mark
scripts/        wallet.js, verify.js, testnet.js
```

ETH-quoted pons v2 launches only.
