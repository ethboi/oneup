# OneUp contract interfaces

Five contracts plus three mocks, all near-sdk Rust. Amounts are `U128` strings in JSON, units as in
[maths.md](maths.md). Events follow NEP-297 with `standard: "oneup"`, `version: "1.0.0"`.

| Contract | Testnet account | Holds |
|---|---|---|
| `house` | `house.oneup.testnet` | pool + trader USDC, positions, epochs, 900M $1UP for emissions |
| `extra-life` (`oneup-extra-life`) | `life.oneup.testnet` | Extra Life NFTs + USDC paid to them, until claimed |
| `oneup-token` | `token.oneup.testnet` | $1UP ledger |
| `ve` | `ve.oneup.testnet` | locked $1UP as lock NFTs, buyback $1UP and exit penalties for lockers |
| `market` (`oneup-market`) | `market.oneup.testnet` | listings of Extra Lives and locks; USDC only while a purchase is in flight |
| `mock-usdc` | `usdc.oneup.testnet` | demo collateral with a faucet (D-8) |
| `mock-oracle` | `oracle.oneup.testnet` | testnet prices pushed by the keeper from Pyth Hermes (D-6) |
| `mock-swap` | `swap.oneup.testnet` | USDC → $1UP buybacks on testnet (D-9) |

Account names are placeholders until `oneup.testnet` is created.

## Who calls what

```
trader ──ft_transfer_call──▶ usdc ──ft_on_transfer──▶ house        deposit
trader ─▶ house.place_open / place_close / withdraw
keeper ─▶ house.fill / liquidate / take_profit / hit_target / hit_stop ──▶ oracle.get_price (cross-contract)
keeper ─▶ house.close_epoch ──▶ ve.checkpoint, life.mint_batch, $1UP→ve (loser locks), usdc→life (pot)
owner  ─▶ house.buyback ──▶ swap ──▶ house ──$1UP──▶ ve (lockers)
holder ──ft_transfer_call──▶ token ──ft_on_transfer──▶ ve           lock
seller ─▶ life|ve.nft_approve(market, {price}) ──▶ market.nft_on_approve      list
buyer  ──ft_transfer_call──▶ usdc ──▶ market ──▶ life|ve.nft_transfer ──▶ USDC to seller   buy
```

## house

### Calls

| Method | Caller | Does |
|---|---|---|
| `ft_on_transfer(sender_id, amount, msg)` | USDC contract | `msg = ""` credits the sender's free balance; `{"open":{market_id, side, margin, leverage, take_profit?, stop_loss?}}` credits it and places an open in the same step (a refused open refunds the whole transfer); `{"seed":{}}` (owner) adds to pool and mints the seed Extra Life |
| `withdraw(amount)` | trader | sends free balance; refunds on failed transfer |
| `place_open(market_id, side, margin, leverage, take_profit?, stop_loss?) → order_id` | trader | moves margin from free balance into the order; pre-checks solvency and capacity with the order counted; optional trigger prices go with the position (D-19) |
| `set_triggers(position_id, take_profit?, stop_loss?)` | owner of the position | sets or clears them; they fire only on prices published after this call |
| `place_close(position_id) → order_id` | owner | only after the 60 s minimum hold |
| `fill(order_id)` | anyone (keeper) | reads oracle; applies the fill rules in maths §2; opens or closes the position |
| `expire(order_id)` | anyone | after `FILL_WINDOW` with no valid price; refunds margin |
| `liquidate(position_id)` | anyone | latest price; pnl ≤ −0.9M → margin to pool |
| `take_profit(position_id)` | anyone | latest price; pnl at cap → close |
| `hit_target(position_id)` / `hit_stop(position_id)` | anyone | latest price past the trader's trigger, after the minimum hold and newer than the trigger → close at that price (reason `Target` / `Stop`) |
| `close_epoch(limit)` | anyone | resumable: first call freezes epoch `e`, fixes its $1UP release (maths §8), checkpoints `ve` and starts `e+1` ("begun"); then mints Extra Lives and loser locks, `limit` (≤ 15) losers per call ("minting"), waits for both to land ("waiting for mints"), expires lives past their window ("expiring"), pays the pot and sets aside buyback USDC ("closed") |
| `buyback(epoch, min_out)` | owner (D-10) | swaps the epoch's buyback USDC; the $1UP goes to `ve` for that epoch's lockers |
| `add_market(market_id, feed_id, max_leverage)` | owner | new markets get `market_capacity_ppm` of the pool (D-14) |
| `set_capacity(market_id, ppm)` | owner | |

`market_id` is a short symbol (`"NEAR-USD"`); `side` is `"Long" | "Short"`.

### Views

`get_balance(account_id)`, `get_position(id)`, `get_positions(account_id)`, `get_orders(account_id)`,
`get_markets()`, `get_solvency()` → `{pool, liability, reserve, surplus, markets: [{id, long_liab,
short_liab, capacity}]}`, `get_epoch()` → `{id, started_at, ends_at, losses, payouts, close_state}`,
`get_pending_life(account_id)` → losses so far this epoch, `quote_open(market_id, side, margin, leverage)`
→ `{allowed, reason?, cut_rate, liq_price, max_profit}`, `get_emissions(epoch)` → `{scheduled, released,
locked, carry}`, `get_emission_carry()`, `get_buyback(epoch)`, `get_params()`.

### Events

`deposit`, `withdraw`, `order_placed`, `order_filled`, `order_expired`, `position_opened`,
`position_closed {pnl, cut, payout}`, `liquidated`, `epoch_closed {house_net, reserve, surplus, el_pot,
bb_pot}`.

## extra-life (NEP-171 + NEP-177 metadata + NEP-181 enumeration)

Payout uses a product accumulator so claims are O(1). Each epoch pays `pay_j = r × owed_remaining_j` with
`r = el_pot / Σ owed_remaining ≤ 1`, so every token's remaining owed shrinks by the same factor:

```
ACC_e      = ACC_{e−1} × (1 − r_e)                      # 1e27 fixed point
remaining  = owed × ACC_now / ACC_at_mint
paid_total = owed − remaining
claimable  = paid_total − claimed
```

When `ACC` reaches 0 (everything owed was paid) a new era starts at 1e27; tokens from older eras are Full
Heals.

| Method | Caller | Does |
|---|---|---|
| `mint_batch(epoch, items: [{owner, face, cap_ppm}])` | `house` | one token per loser; `ACC_at_mint` = current ACC, so the same epoch's pot pays them (D-4) |
| `ft_on_transfer(sender_id, amount, msg)` | USDC, sender `house` | `{"epoch_pot":{"epoch":e}}` → applies `r_e` |
| `expire(through_epoch) → U128` | `house` | lives minted in `through_epoch` or earlier stop earning (D-13); returns the total still owed, which the house mirrors |
| `claim(token_ids)` | token owner | sends claimable USDC |
| `nft_transfer…` | standard | unclaimed USDC moves with the token |

Views: `life_info(token_id)` → `{epoch, face, cap, owed, paid, claimable, full_heal}`,
`lives_for_owner(account_id)`, `total_owed_remaining()`. Metadata image is rendered from cap and progress.

## oneup-token (NEP-141 + NEP-148)

1_000_000_000 $1UP, 18 decimals, minted once at `new()`: 900M to `house` (emissions), 50M to the Rhea seed
account, 50M to the treasury. No mint function after that, so the supply is fixed by code (the spec's
"emissions minter" is the house's emissions schedule paying from its 900M).

## ve

| Method | Caller | Does |
|---|---|---|
| `ft_on_transfer` from $1UP, `{"lock":{"epochs":n}}` | holder | mints a lock NFT, 1 ≤ n ≤ 104 |
| `ft_on_transfer` from $1UP, sender `house`, `{"lock_for":{"items":[[owner, amount], …]}}` | `house` | 104-epoch locks for losers (≤ 30 per transfer) |
| `ft_on_transfer` from $1UP, sender `house`, `{"buyback":{"epoch":e}}` | `house` | rewards for epoch `e`'s lockers |
| `checkpoint(epoch)` | `house` | fixes the total weight for `epoch` |
| `claim(token_id, epochs)` | lock owner | the lock's share of each finished epoch's rewards |
| `claim_many(token_ids, epochs)` | lock owner | the same for up to 30 locks, in one transfer |
| `merge(token_ids) → token_id` | lock owner | 2 to 30 running locks into one new lock: amounts add up, it ends at the latest end and counts from the next epoch; the old locks earn through the current epoch, claimed through the new one (D-18) |
| `exit_early(token_id) → penalty` | lock owner | returns the lock less the penalty (maths §9); the penalty goes to the next epoch's lockers |
| `unlock(token_id)` | lock owner | after the lock ends |

Locks are NEP-171 (transferable, with approvals); rewards go to the current owner.

Views: `lock_info(token_id)` → `{amount, created, end, from_loss, power, exit_penalty, exited, withdrawn}`,
`locks_for_owner(account_id)`, `get_total_power(epoch)`, `get_pending_power()`, `get_rewards(epoch)`,
`get_claimable(token_id, epochs)`.

## market

| Method | Caller | Does |
|---|---|---|
| `nft_on_approve(token_id, owner_id, approval_id, msg)` | the life or ve contract, from `nft_approve` | lists the NFT; `msg = {"price":"<USDC>"}`; approving again re-prices |
| `ft_on_transfer` from USDC, `{"buy":{"nft_contract","token_id"}}` | buyer | moves the NFT to the buyer through the approval, pays the seller, refunds change; refunds everything if the NFT can't move |
| `delist(nft_contract, token_id)` | seller | |
| `withdraw_owed()` | seller | USDC whose payout failed |

Views: `get_listings(from_index, limit)`, `get_listing(nft_contract, token_id)`, `get_owed(account_id)`.
Event `oneup_market/sold` on each sale.

## Oracle (Pyth-compatible)

```
get_price(price_identifier) → Option<{price: I64, conf: U64, expo: i32, publish_time: i64}>   # null if stale
get_price_unsafe(price_identifier) → same, no staleness check
price_feed_exists(price_identifier) → bool
```

`price_identifier` is a Pyth feed id, hex without `0x`. The house calls `get_price_unsafe` and applies its own
checks (maths §2), so the fill rules don't depend on the oracle's 60 s threshold.

- Mainnet: Outlayer `price-oracle-pyth.near`.
- Testnet: `mock-oracle` (D-6). Outlayer `price-oracle-pyth.testnet` is stale. `mock-oracle` implements
  the calls above plus `push_prices([{feed_id, price, conf, expo, publish_time}])` (pusher only). It
  rejects a `publish_time` that isn't newer than the stored one.
