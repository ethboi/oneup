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

## D-12 · The reserve floor is the seed actually deposited · **Decided**

Spec: "The reserve is 1.2× the solvency total, and never below the $25K seed." The code first hard-coded
$25K. With the 1M local seed (needed for D-1 capacity), 975K of seed money counted as surplus: the first
live epoch paid 292K to Extra Lives and 146K into $1UP buybacks from a 500 house profit. Now the floor is
the total seeded, so the seed is only ever repaid from profit. Same result as the spec at a $25K seed.

## D-13 · Extra Lives expire after 13 epochs · **Decided (20 Oct 2026)**

`pnpm sim` (OneUp vs Papertrade-style on the same flows, 20 seeds, each loss followed for 52 weeks):

| USDC back within a year per $1 lost | Q1 | Q2 | Q3 | Q4 |
|---|---|---|---|---|
| OneUp, spec as written | 24.0¢ | 13.3¢ | 8.7¢ | 7.0¢ |
| Papertrade-style | 13.0¢ | 17.3¢ | 10.7¢ | 7.8¢ |
| OneUp, lives expire after 26 epochs | 17.2¢ | 11.6¢ | 9.8¢ | 10.7¢ |
| OneUp, lives expire after 13 epochs | 13.0¢ | 10.3¢ | 9.3¢ | 10.2¢ |

As written, OneUp is *less* fair to late losers than Papertrade-style, even at flat volume (16.4¢ → 4.9¢).
Cause: each profitable epoch mints claims worth 1.2–2.0× its profit, but only ~30% of surplus is paid to
lives, so unpaid claims pile up without bound and every new life shares the pot with the backlog: a payout
queue for losers. Expiring lives after N epochs bounds the backlog; at 13 epochs recovery is nearly flat and
late losers get ~10¢ instead of 7¢. What OneUp does win on: year-1 losers take 6.6% of year-3 payouts vs
12.0% under Papertrade-style (they were 8.5% of losses).

Also worth knowing for the pitch: with Papertrade's real parameters (flat 100 PAPER/$ below $2M LP, LP
capped at $5M) the first 10% of losses hold ~10.5% of PAPER, so its early-holder problem is milder than the
pitch implies. Its weak point in this model is the perpetual claim, not the mint rate.

## D-14 · No market voting; markets get half the pool · **Decided (21 Oct 2026)**

Voting on which markets get the house's capacity and emissions was the hardest part to explain and not
needed for the core idea. Removed: votes, bribes and vote-listed markets. Now each new market may use up to
`market_capacity_ppm` of the pool (default 50%, owner-adjustable per market with `set_capacity`), with the
pool-wide solvency rule (D-1) still on top, so busy markets get more capacity and no single market can take
it all. The owner lists markets, like the owner-only buybacks (D-10).

## D-15 · ve1UP is a lock that earns buybacks, up to two years · **Decided (21 Oct 2026)**

Lock $1UP for 1 to 104 epochs as a transferable NFT. Weight = amount × epochs left ÷ 104 (decaying, from
the epoch after locking; one O(1) tally of Σ A and Σ A·end). Each epoch's buyback $1UP is shared across
that epoch's lockers by weight; an epoch with nobody locked passes its buyback to the next. Leaving early
costs `50% × epochs left ÷ 104` (rounded up), and the penalty goes to the next epoch's lockers: a flat 50%
would make someone two weeks from the end wait instead. Or sell the lock on the market (D-17), where
buyers set the real discount and the penalty is just the floor.

## D-16 · Only losers earn $1UP, released by house profit, as locks · **Decided (21 Oct 2026)**

Winners are paid in USDC and earn no $1UP. Each epoch releases `oneup_per_usdc` (20) $1UP per USDC of house
profit, capped by the epoch's share of the 4-year schedule plus anything unreleased before; the rest
carries forward. The release is shared across the epoch's losers by loss and arrives as 104-epoch locks,
minted in the same close batches as their Extra Lives (batches of 10 so both fit one transaction).

Why: a long and a short on yourself costs only the winner's 10% cut. Paying emissions by raw loss let a
farmer buy $1UP far below any sensible price. `pnpm farm` (sim/src/farm.ts) gives the $1UP fully diluted
value above which farming pays:

| Rules | First 13 weeks, farming = 1× real volume | Year 2, 1× |
|---|---|---|
| Before: half to losers by loss, half to winners by cut, liquid | $3.3M | $76M |
| Losers only, 100 $1UP per $1 of profit, locked | $12M | $161M |
| **Losers only, 20 per $1, locked** | **$62M** | **$97M** |
| Losers only, 10 per $1, locked | $123M | $139M |

20 per $1 releases ~98% of the 900M within the 4 years on the simulation's volume path (10 per $1 only
60%). The rate is a parameter, so it can be tuned once real volume is known.

## D-17 · A marketplace for Extra Lives and locks · **Decided (21 Oct 2026)**

`contracts/market`: list with the NFT standard's `nft_approve(token, market, msg = {"price"})`, buy with
one USDC `ft_transfer_call`. The NFT moves straight from seller to buyer through the approval and the
seller is paid in the same flow; if the NFT can't move (sold or given away elsewhere, approval revoked) the
buyer is refunded and the stale listing removed. No fees. Only the Extra Life and ve contracts are
accepted.

## D-18 · Merging locks · **Decided (21 Oct 2026)**

Every profitable epoch gives each loser a new lock, so active traders collect many small ones. `merge`
combines 2 to 30 running locks into one: the amounts add up and it ends at the latest end (so nobody's
$1UP unlocks earlier than it would have). The new lock counts from the next epoch, like any new lock. The
old locks are closed but still earn the current epoch (their weight was fixed for it), and anything they
earned and didn't claim is paid through the new lock; what they already claimed isn't paid twice.

## D-19 · Take-profit and stop-loss · **Decided (21 Oct 2026)**

A position can carry a take-profit and a stop-loss price, set with the order or changed later
(`set_triggers`). The keeper sees the price cross and calls `hit_target` or `hit_stop`; the house checks
the trigger against the oracle and **places a close**, which fills at the next price published after the
hit, exactly like the trader's own close (a stop-market order). Three rules keep it from becoming a way
round delayed fills (D-2):

- **A hit never settles at a price already on chain.** The first version closed at the oracle price that
  crossed the trigger. The security review (21 Oct) showed why that's wrong: a trigger may be set at any
  price (a stop at `u128::MAX` is always "hit"), so a trader could call `hit_stop` whenever the on-chain
  price lagged the market in their favour, up to ~1% for up to 60 s on Outlayer, or 100%+ of margin at
  high leverage. Placing a close for the next price makes a hit worth exactly a manual close.
- **Only newer prices fire it.** A trigger fires only on a price published after it was set (for one set
  with the order, after the order).
- **The minimum hold applies**, as for a manual close.

The close records why it was placed (`Close`, `Target` or `Stop`) and the trade history shows it.

A loss closed by a stop counts toward an Extra Life like any other.

## D-20 · A Sputnik DAO owns the house · **Decided (21 Oct 2026)**

The house's owner lists markets, pauses them and sets their share of the pool (D-14). On localnet the
owner is a Sputnik v2 DAO running the exact code mainnet Sputnik DAOs run (`contracts/vendor`, hash checked
against the mainnet factory). The council is the demo trader and two bots; 2 of 3 approve a proposal,
which calls the house. Routine buybacks (D-10) go through an `operator` role instead, so the DAO doesn't
vote every epoch, and order fills go through a `keeper` role (D-23). The owner can still change the
oracle, the swap and the params, so whoever owns the house is trusted; the DAO is how that trust is spread.

## D-21 · NEAR Intents deposits · **Decided (21 Oct 2026)**

Supersedes D-7. The official Verifier and PoA token factory (`defuse/v0.4.2`, sha256-checked; mainnet runs
0.4.5, which has no published build) run on localnet, signed with the official
`@defuse-protocol/intents-sdk`. A user pays from another chain in one signed intent: a token_diff swapping
the bridged asset for USDC with a solver, and an `ft_withdraw` of the USDC to the house whose message
credits them (`{"for":…}`) or opens their trade (`{"open":…}`). Only the bridge is simulated (the root
account mints the PoA token into the Verifier, as a real bridge would after a deposit).

The house accepts a message naming an account only from the Verifier, and never refuses one: the Verifier
doesn't return tokens a receiver rejects, so a refused open leaves the deposit in the named account's free
balance. Since whoever withdraws writes the message, an Intents open may only trade the USDC that deposit
brought, never the named account's existing balance (security review, 21 Oct).

## D-22 · Backer Lives bootstrap the pool · **Decided (21 Oct 2026)**

D-1 needs a deep pool: with both sides counted, a $25K seed allows ~$2.8K of total margin. Before, only
the owner could seed, and the seed got a 1.0× Extra Life: money back from profit, never anything more.
Nobody else had a reason to fund the house.

Now anyone can **back** the pool (`{"back":{}}`, at least 10 USDC) until the total seeded reaches
`backing_target` ($1M by default). A backing:

- **joins the pool for good and raises the reserve floor** (D-12), so it is only ever repaid from house
  profit, never paid out as surplus;
- **mints a Backer Life**: an Extra Life that never expires, paid from the same pots as losers' lives, pro
  rata to what it is still owed;
- **is owed the curve's average over the backing**: losers' lives are capped at 2.0× at an empty pool,
  falling to 1.2× at $1M (`life_cap_ppm`); a backing of `x` into a pool of `p` is owed the average of that
  curve over `[p, p + x]` (`backer_cap_ppm`). Early dollars earn more, and splitting a backing into pieces
  earns the same (to within 2 ppm, a property test);
- **exits through the market**: a Backer Life is an NFT like any other and sells on the marketplace (D-17).

Why this and not an LP vault (deposit, get shares, withdraw against free capital, as GMX does): LP shares
would compete with Extra Lives and buybacks for the same house profit and need a new profit split; a
withdrawable pool also shrinks exactly when traders are winning. Backer Lives reuse the existing pieces and
tell one story: backers are losers by choice, early ones are paid most, and everyone is paid from the same
profit. The cost is that backers share pots with losers, so a big round dilutes the losers' lives until
it's repaid; the round's target bounds that.

The owner's own seed is a Backer Life at 1.0×. On localnet the owner seeds $250K and four bots back $550K
at deploy, leaving $200K of the round for the demo trader; the collector bot backs now and then.

## D-23 · Only the keeper fills · **Decided (21 Oct 2026)**

D-2 let anyone fill an order with any price inside the 30 s window, so a trader running their own keeper
could pick the price, and let an open expire for free if nothing suited them. With a `keeper` set
(`set_keeper`), only the keeper (or the owner or operator) may `fill` orders and `take_profit` at the cap.
`hit_target`/`hit_stop` stay open to anyone, since they now only place a close (D-19), and liquidations stay
open to anyone, since they only ever help the pool. The keeper is trusted to fill promptly at the first
price after the order; on mainnet that trust could move to a fill rule checked against the oracle's
history.

## D-24 · Extra Lives and $1UP go by net loss · **Decided (21 Oct 2026)**

Lives were sized by each wallet's gross losses in the epoch. A long and a short on yourself loses one side
and wins the other, minus the winner's cut, yet the losing leg counted in full: a cheap way to take most of
an epoch's lives and $1UP. Now each wallet's epoch total is losses minus profit paid, and only wallets above
zero share the epoch's face value and $1UP, by net loss. Splitting the legs across two wallets still works,
but then the winning wallet's cut (10–25%) is the cost, which D-16's farming numbers already price in. The app warns about, and the order
form refuses, a trigger already past the price; the contract allows it, since the newer-price rule makes
it harmless.

 · **Noted**

- Rounding dust from sharing buybacks by weight stays in `ve` (no sweep).
- `mock-swap` updates reserves before its payout lands; a failed payout isn't rolled back.
- ve weight sums use `amount × end epoch`; fine for weekly epochs, revisit before running 10-minute epochs
  for years.
- Loser locks are one NFT per loser per profitable epoch, with storage paid by `ve`; a minimum lock size
  would bound that.
- A full close batch (10 lives + 10 locks) hasn't been gas-tested at the limit; the demo has ≤ 7 losers
  per epoch.
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
