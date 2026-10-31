# OneUp maths

Exact formulas the contracts, `packages/sdk` and `sim` all implement. Every formula has a test vector at the
end; contract tests and SDK tests both assert those vectors. Parameters come from the spec's Parameters table.

## Units

| Quantity | Type | Scale |
|---|---|---|
| USDC amounts | `u128` | 1e6 (6 decimals) |
| $1UP amounts | `u128` | 1e18 (18 decimals) |
| Prices | `u128` | 1e8, normalised from the oracle's `price × 10^expo` |
| Rates, shares, multipliers | `u128` | 1e6 (ppm): 10% = 100_000, 1.84× = 1_840_000 |
| Time | `u64` | seconds (oracle `publish_time`) and nanoseconds (block timestamp), converted at the boundary |

Rounding: every amount **paid out** of the house rounds down; every amount **owed to** the house rounds up.
Dust stays in the pool.

## 1. Positions

Margin `M`, leverage `k` (1 ≤ k ≤ max_leverage), notional `N = M × k`, entry price `P0`, current price `P`.

```
raw_pnl_long  = N × (P − P0) / P0
raw_pnl_short = N × (P0 − P) / P0
pnl           = clamp(raw_pnl, −M, 9 × M)        # loss bounded by margin, profit by the cap
```

- **Max liability** of a position to the house: `L = 9 × M` (the profit cap, `PROFIT_CAP = 9`).
- **Liquidation**: when `pnl ≤ −0.9 × M`. Liquidation prices:
  `P_liq_long = P0 × (1 − 0.9 / k)`, `P_liq_short = P0 × (1 + 0.9 / k)`. The full margin `M` goes to the pool.
- **Take-profit at cap**: when `pnl = 9 × M` the keeper may close it (closing at the cap cannot get worse
  for the trader, and it frees the liability).
- **Minimum hold**: a close can't be placed until 60 s after the fill.

## 2. Delayed fills

An order (open or close) records `placed_at` (block time). A keeper fills it with the oracle price `p` if:

```
p.publish_time > placed_at                    # price unknown when the order was placed
p.publish_time ≤ placed_at + FILL_WINDOW      # FILL_WINDOW = 30 s; past it the order expires, margin refunded
now − p.publish_time ≤ MAX_PRICE_AGE          # MAX_PRICE_AGE = 60 s
p.conf / p.price ≤ MAX_CONF                   # MAX_CONF = 1% (10_000 ppm)
```

The window bounds waiting but does not prove the first later price was chosen. The keeper remains trusted for prompt execution; see D-23.
A limit open (D-30) waits longer, `FILL_WINDOW` becoming `LIMIT_EXPIRY` (24 h), and also needs
`p.price ≤ limit` for a long or `p.price ≥ limit` for a short; it fills at `p.price`. The trader chose that
price in advance, so waiting for it is the point, not an edge.
Liquidations and take-profits use the latest valid price, not a delayed one.

## 3. Solvency

Per market `m`, over open positions (including pending opens, counted at their margin):

```
long_liab_m  = Σ 9 × M   over longs in m
short_liab_m = Σ 9 × M   over shorts in m
```

**Rule (see decisions D-1):**

```
liab_m = long_liab_m + short_liab_m           # current deployment: both sides, sound across time
# Historical rejected alternative: max(long_liab_m, short_liab_m); unsafe across asynchronous closes

E = Σ_m liab_m
open allowed only if   E_after ≤ pool   and   liab_m_after ≤ capacity_m
capacity_m = cap_m × pool                     # cap_m = 50% by default (D-14)
```

`pool` = house-owned USDC: seed + realised trader losses − realised winner payouts − Extra Life payouts −
buyback spend. Trader margins and free balances are held separately and never count as pool.

Closes and liquidations are never refused. Epoch payouts keep `pool ≥ 1.2 × E` (§6), so they never break
the rule.

## 4. Winner's cut

Fixed at open, from the position's share of the pool's room:

```
u        = L / pool_at_open                   # L = 9 × M
cut_rate = min(CUT_MAX, CUT_BASE + u / 2)     # CUT_BASE = 10%, CUT_MAX = 25%
cut      = ceil(cut_rate × pnl)               # only when pnl > 0
payout   = M + pnl − cut                      # winner
payout   = M + pnl                            # loser (pnl < 0), the |pnl| goes to the pool
```

The implemented size term (`u / 2`) means: a position using 10% of the pool's room pays 15%, one using 30% or
more pays the 25% hard maximum.

## 5. Epoch result and Extra Life minting

Per epoch `e`, over positions **closed** in `e` (open positions don't count until they close):

```
losses_e      = Σ |pnl|  over losing closes (liquidations count the full M)
payouts_e     = Σ (pnl − cut) over winning closes
fees_e        = marketplace fees received during e
house_net_e   = max(0, losses_e + fees_e − payouts_e)
loss_i        = max(0, wallet_i losing closes − wallet_i net winning profits)
net_losses_e  = Σ loss_i
```

If `house_net_e > 0`, each wallet with positive net loss across all markets gets one Extra Life (D-24):

```
base_e = min(house_net_e, net_losses_e)        # fees never make a Life worth more than its loss
face_i = floor(base_e × loss_i / net_losses_e)    # so face_i ≤ loss_i
cap    = 2.0 − 0.8 × min(pool, 1_000_000) / 1_000_000      # pool = pool at epoch close, before payouts
owed_i = floor(face_i × cap)
```

If `house_net_e ≤ 0`, no Extra Lives are minted for `e`.

The seed provider receives a Backer Life with face equal to the deposited seed and cap 1.0.
Seed and public backing capital enter the spendable pool only after the Backer Life mint succeeds.
Pending backing reserves its bootstrap allocation and cap position. New backing pauses while closing;
a failed mint returns its USDC to the sender's free balance and restores its reserved $1UP allocation.

Mid-epoch, the app shows a **pending Extra Life** (the wallet's losses so far); face value is only known at
epoch close. (The demo script says one "drops into the wallet" on liquidation; it drops as pending.)

## 6. Surplus and payout

At epoch close, after minting `e`'s Extra Lives:

```
R       = max(1.2 × E, seed)                    # reserve: never below the seed actually deposited
S       = max(0, pool − R)                      # surplus
P       = 0.5 × S                               # max payout this epoch
el_pot  = min(0.6 × P, Σ owed_remaining)        # to unpaid Extra Lives (including ones just minted)
bb_pot  = 0.3 × P + (0.6 × P − el_pot)          # buybacks get whatever the Extra Lives couldn't use
                                                # the remaining 0.1 × P simply stays in the pool
```

The pot is split first (D-26): two thirds to losers' lives, one third to Backer Lives; whatever one side can't
use goes to the other. Within a side, each earning Extra Life `j` is paid the same fraction `δ` of what it was
owed, capped at what it's still owed (D-25):

```
δ      = el_pot / Σ owed_j                      # over lives still earning
pay_j  = min(owed_j × δ, owed_remaining_j)
```

A life the cap stops is filled exactly and what it couldn't take is shared again, with the same rule, among the
rest (water-filling). Amounts round down, so lives are never paid more than the pot. When `paid_j = owed_j` it
becomes a **Full Heal** and stops earning.

**Expiry (D-13).** A life minted in epoch `m` shares the pots of epochs `m … m + LIFE_EXPIRY` (13 by default),
then expires: it keeps what it earned (still claimable) and drops out of `Σ owed_remaining`. Before paying
epoch `E`'s pot, every life minted in `E − LIFE_EXPIRY − 1` or earlier expires. The seed's life never
expires. Without this, unpaid claims grow without bound and later losers recover far less (see D-13).

After payout `pool' ≥ pool − 0.9 × 0.5 × (pool − R) > R ≥ 1.2 × E`, so the solvency rule still holds.

## 7. Buybacks to lockers

```
usdc_e   = bb_pot_e                              # swapped to $1UP (Rhea; mock-swap locally)
lock l gets   oneup_e × weight_l,e / Σ weight_e  # §9; an epoch with Σ weight = 0 passes it to the next
```

## 8. $1UP emissions (losers only, D-16)

```
SUPPLY        = 1_000_000_000 $1UP
EMISSIONS     = 900_000_000 over 208 epochs
per_epoch     = floor(EMISSIONS / 208)          # = 4_326_923.076923076923076923 $1UP in base units
                                                # epoch 208 also gets the remainder
available_e   = carry_{e−1} + per_epoch
release_e     = min(available_e, RATE × base_e)           # RATE = 20 $1UP per USDC; base_e as in §5
carry_e       = available_e − release_e (+ unassigned rounding)
loser i gets  release_e × loss_i / net_losses_e, as a 104-epoch lock (§9)
```

Winners earn USDC, not $1UP. With `house_net ≤ 0` nothing is released and the whole schedule carries.
After epoch 208 the schedule is 0 but the carry keeps releasing. Failed lock receipts retain their
original recipient allocations in the on-chain recovery queue; they do not become carry. Settlement
waits for confirmed issuance. Retries preserve the original creation epoch and cannot issue twice.

## 9. Locks (ve1UP, D-15)

Lock `A` $1UP for `n` epochs (1 ≤ n ≤ 104; one epoch = one week, 10 min in the demo). Made in epoch `c`,
it counts from `c + 1` and ends at `end = c + 1 + n`:

```
weight(e) = A × (end − e) / 104                 # for c < e < end
Σ weight(e) = (S1 − e × S0) / 104               # S0 = Σ A, S1 = Σ A × end over running locks
exit penalty = ceil(A × 50% × (end − e − 1) / 104)   # leaving in epoch e; goes to epoch e+1's lockers
```

## Test vectors

### V1 — Extra Life sizing (spec example)
losses_e = 300_000, payouts_e = 200_000 → house_net = 100_000. Alice loss 3_000 → face = 1_000.
pool = 200_000 → cap = 2.0 − 0.8 × 0.2 = 1.84 → owed = **1_840**.

### V2 — Position PnL and liquidation
Long, M = 1_000, k = 50 → N = 50_000, P0 = 5.00.
- P = 5.40 → pnl = 50_000 × 0.40 / 5.00 = **4_000**
- P = 6.00 → raw 10_000 → capped **9_000**
- P_liq = 5.00 × (1 − 0.9/50) = **4.91**; short at same terms: **5.09**

### V3 — Winner's cut
pool_at_open = 100_000, M = 1_000 → L = 9_000, u = 0.09 → cut_rate = 0.10 + 0.045 = **14.5%**.
pnl = 5_000 → cut = **725**, payout = 1_000 + 5_000 − 725 = **5_275**.
M = 4_000 → u = 0.36 → 0.28 → capped **25%**.

### V4 — Solvency (one market, pool = 25_000, capacity = 100%)
Open: long M = 2_000 (L 18_000), short M = 500 (L 4_500).
- D-1 rule: E = 22_500. New long M = 300 → E = 25_200 > 25_000 → **refused**.
- Spec rule: E = max(18_000, 4_500) = 18_000; new long → max(20_700, 4_500) = 20_700 → allowed.

### V5 — Epoch payout
pool = 200_000, E = 50_000 → R = 60_000, S = 140_000, P = 70_000.
- Owed remaining: Alice 1_840, Bob 10_000, seed 25_000 → Σ = 36_840; 0.6P = 42_000 → el_pot = **36_840**
  (all paid in full, all three become Full Heals), bb_pot = 21_000 + 5_160 = **26_160**, 7_000 stays.
- pool' = 200_000 − 36_840 − 26_160 = **137_000** ≥ 1.2 × 50_000 ✓
- Same with pool = 120_000: R = 60_000, S = 60_000, P = 30_000, 0.6P = 18_000 = el_pot →
  Losers first receive 12,000 and backers 6,000. Alice and Bob fill at **1,840** and **10,000**;
  the unused 160 spills to the seed Backer Life, which receives **6,160**. bb_pot = **9,000**.

### V6 — Emissions
per_epoch = 4_326_923.0769…. house_net = 1_350 USDC → release = min(4_326_923.08, 20 × 1_350) =
**27_000**; losses Bob 1_000, Carol 500 → locks of **18_000** and **9_000**; carry = **4_299_923.0769…**.

### V7 — Lock weight
Lock 1_000 for 104 epochs → weight **1_000**; after 52 epochs **500**. Lock 1_000 for 26 → **250**.

### V8 — Exit penalty
1_000 locked, 104 epochs left → **500**; 52 left → **250**; 1 unit with 1 left → **1** (rounded up).

### V9 — Release cap
house_net = 10_000_000 USDC → 20 × that is 200M, capped at available = **per_epoch** (+ carry).

## Asynchronous close and jackpot bounds

A new close waits for earlier life-pot callbacks, pending backing mints and their token locks before
checkpointing the next epoch. Partial pot refunds restore only their refunded debt. A jackpot draw freezes
its random target, ticket total and payout amount, then visits/removes at most the requested close batch
(maximum 15) ticket accounts per call. Later harvested interest remains for the next draw. A round returns
`closed` only after the draw and payout complete. A zero jackpot or no tickets rolls over without discarding
tickets. Existing local deployments must be recreated to use this contract state layout; there is no
upgrade/migration path in this proof of concept.
