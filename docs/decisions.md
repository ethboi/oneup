# Decisions

Open = needs a call. Decided = frozen for the build.

## D-1 · Solvency rule: count both sides · **Open (recommend both sides)**

The spec counts only the bigger side per market ("longs and shorts can't both win"). That holds only if
both sides settle at the same moment. Positions close at different times, so both sides can win:

1. Long, M = 1_000 at 100x, entry 1.00. Max profit (9_000) at 1.09.
2. Price runs to 1.20. A short opens there, M = 1_000 at 10x (liquidates at 1.308).
   The spec rule sees max(9_000, 9_000) = 9_000 and allows it with a 9_000 pool.
3. The long closes at the cap: pool pays 9_000 → pool = 0.
4. Price falls 90% to 0.12. The short is owed 9_000. **The pool can't pay.**

This is the first thing a perps judge (Kain Warwick) will try. Memecoin markets make step 4 realistic.

Options:
- **A — count both sides (recommended).** `liab_m = long + short`. Sound for any price path, same as
  GMX v1 reserving max profit per position. Cost: a balanced market gets half the capacity; a one-sided
  market is unchanged. The pitch becomes "every open position's max win is reserved", which is simpler to
  defend than "they can't both win".
- B — spec rule plus mark-to-market (count unrealised profit already locked in). Tighter but still
  path-dependent, harder to prove, and needs a keeper to re-check.
- C — spec rule as written, rely on the 1.2× reserve. Not sound; don't pitch "can't go bust".

Demo impact of A: with a $25K seed, total margin across both sides of all markets ≤ ~$2.78K. Seed the
testnet pool with $250K–$1M mock USDC so the bots have room.

## D-2 · Delayed fills need a fill window · **Open (recommend 30 s)**

The oracle is push-based: the contract only sees the latest price. A trader running their own keeper could
place an order and wait to fill until a later price suits them. Fix: a fill must use a price published
within `FILL_WINDOW` (30 s) after placement, else the order expires and the margin is refunded. Closes are
delayed the same way; liquidations and take-profit at cap use the latest price. Residual risk: a
keeper-trader picks among the prices inside the 30 s window; the 60 s minimum hold and the confidence check
bound it. Depends on the oracle's update cadence (R-2).

## D-3 · Winner's cut size curve · **Open (proposal)**

`cut_rate = min(25%, 10% + u/2)` with `u = 9M / pool_at_open`. Spec says "grows with size" without a
formula. Tune in the simulation.

## D-4 · New Extra Lives are paid in the epoch they are minted · **Open (recommend yes)**

Makes the demo's "lose → epoch ends → get paid" work in one epoch. Mid-epoch the app shows a pending Extra
Life (losses so far), since face value is set at epoch close.

## D-5 · An API/indexer beyond the spec · **Decided**

Thin indexer for history. App must still work from contract views alone (cut line 5 in PLAN.md).

## D-6 · Prices: our own Pyth-compatible oracle on testnet · **Open (recommend)**

Outlayer's testnet oracle is stale (R-2) and its `conf` is always 0. Deploy `mock-oracle` as the real
testnet oracle: the keeper pushes NEAR/BTC/ETH (+ a memecoin) from Pyth's off-chain Hermes API every ~5 s,
with the Pyth `conf` included. The house reads it through the same `get_price` call as Outlayer, so mainnet
is a one-address change. Honest framing for judges: the testnet push is trusted; mainnet uses Outlayer.
The `MAX_CONF` check only bites with real confidence values, so keep Hermes' `conf`.

## D-7 · NEAR Intents is mainnet-only · **Open (recommend B)**

No testnet deployment exists (R-3), but the DeFi track names Intents for perps.
- A — run the whole demo on mainnet with small amounts. Real, but adds risk and cost in the last week.
- **B — testnet exchange + a real mainnet Intents deposit shown in the app** (quote → deposit address →
  status via 1Click), with the testnet credit simulated from the completed swap. Shows the integration,
  keeps the exchange on testnet.
- C — drop Intents (cut line 2).

## D-8 · Demo collateral: mock USDC · **Open (recommend)**

Circle testnet USDC exists (R-4) but its faucet can't fund a $250K–$1M pool (D-1) and the bots. Use
`mock-usdc` (6 decimals, faucet button in the app). Keep the house generic over the USDC account so
Circle's id is a config change.

## D-9 · Buybacks on testnet: mock swap · **Open (recommend)**

Rhea's testnet exchange (`ref-finance-101.testnet`) exists but looks unmaintained since Nov 2024 (R-5).
Build the swap against a small `mock-swap` (fixed or simple x·y=k pool) behind the same call shape;
try the real Rhea testnet contract only if time allows.

## D-10 · Buybacks are triggered by the owner · **Decided for the POC**

`house.buyback(epoch, min_out)` is owner-only: `min_out` is the worst price accepted, and a
permissionless call would let anyone pass 0 and sandwich the swap. The keeper runs it with the owner key
and a quote minus slippage. Mainnet option: a TWAP check against the pool before swapping, then open it up.

## D-11 · Known POC limits · **Noted**

- Rewards for a (market, epoch) with no voters stay in `ve` (no sweep yet).
- `mock-swap` updates reserves before its payout lands; a failed payout isn't rolled back.
- ve vote sums use `amount × ppm × end epoch`; fine for weekly epochs, revisit before running 10-minute
  epochs for years.
- House storage is paid by the contract (min margin 1 USDC bounds spam); no per-user storage deposits.

## Research (20 Oct 2026)

- **R-1 · Code before 1 Nov?** No explicit rule. The site says "Build your project during the hackathon".
  Submissions accepted 2026-11-01T00:00Z to 2026-11-14T23:59Z; judging 16–18 Nov. A submission needs a
  public repo, a public X post (video or screenshots) saying it was built at NEAR HACKATHON, and the form
  (name, lead, email, team size, tracks, NEAR wallet, 20–2,000 char description). **One submission, not
  editable.** AI judges (Claude Code, Codex) read the repo. → Stay docs-only until 1 Nov, or ask in the
  NEAR Discord. Sources: [nearhackathon.com](https://nearhackathon.com/),
  [HACKATHON.md](https://nearhackathon.com/HACKATHON.md).
- **R-2 · Outlayer oracle.** Pyth-compatible wrapper `price-oracle-pyth.testnet` (mainnet
  `price-oracle-pyth.near`); `price-oracle.testnet` is the native one without Pyth methods. Methods:
  `get_price`, `get_price_unsafe`, `get_price_no_older_than`, `get_ema_price(_unsafe)`, `list_prices`,
  `price_feed_exists`, `get_stale_threshold` (60). Struct `{price: i64, conf: u64 (always 0), expo: -8,
  publish_time: unix s}`. Feed ids are Pyth hex without `0x`; NEAR
  `c415de8d2efa7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750`, BTC
  `e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`, ETH
  `ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` (all exist on testnet). Updates are
  scheduled on mainnet only (60 s staleness or 1% deviation). **On 20 Oct the testnet price was from 6 Feb
  2026 and `get_price` returned null; mainnet was also stale (16 Feb).** → D-6. Sources:
  [NEAR oracles docs](https://docs.near.org/primitives/oracles),
  [Outlayer docs](https://price-oracle.outlayer.ai/docs/), [oracle-ark](https://github.com/zavodil/oracle-ark).
- **R-3 · NEAR Intents 1Click.** Base URL `https://1click.chaindefuser.com`. A key is optional: without
  one there's an extra 0.25% fee; a partner JWT from [partners.near-intents.org](https://partners.near-intents.org/)
  goes in `X-API-Key` / `Authorization: Bearer`. Lead time not documented. **No testnet, and none
  planned.** → D-7. Source: [1Click auth docs](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication.md).
- **R-4 · Testnet USDC.** Circle's testnet USDC is
  `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` (NEP-141, 6 decimals); common mock
  `usdc.fakes.testnet`. → D-8. Source: [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses).
- **R-5 · Rhea testnet.** `ref-finance-101.testnet` per Ref's UI config; repo last updated Nov 2024, no
  current Rhea doc. → D-9. Source: [ref-ui config](https://github.com/ref-finance/ref-ui/blob/main/src/services/config.ts).
