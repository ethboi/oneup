# OneUp contract interfaces

Four contracts plus two mocks, all near-sdk Rust. Amounts are `U128` strings in JSON, units as in
[maths.md](maths.md). Events follow NEP-297 with `standard: "oneup"`, `version: "1.0.0"`.

| Contract | Testnet account | Holds |
|---|---|---|
| `house` | `house.oneup.testnet` | pool + trader USDC, positions, epochs, 900M $1UP for emissions |
| `extra-life` (`oneup-extra-life`) | `life.oneup.testnet` | Extra Life NFTs + USDC paid to them, until claimed |
| `oneup-token` | `token.oneup.testnet` | $1UP ledger |
| `ve` | `ve.oneup.testnet` | locked $1UP, veNFTs, votes, bribes, buyback $1UP for voters, listing bonds |
| `mock-usdc` | `usdc.oneup.testnet` | demo collateral with a faucet (D-8) |
| `mock-oracle` | `oracle.oneup.testnet` | testnet prices pushed by the keeper from Pyth Hermes (D-6) |
| `mock-swap` | `swap.oneup.testnet` | USDC → $1UP buybacks on testnet (D-9) |

Account names are placeholders until `oneup.testnet` is created.

## Who calls what

```
trader ──ft_transfer_call──▶ usdc ──ft_on_transfer──▶ house        deposit
trader ─▶ house.place_open / place_close / withdraw
keeper ─▶ house.fill / liquidate / take_profit ──▶ oracle.get_price (cross-contract)
keeper ─▶ house.close_epoch_* ──▶ life.mint_batch, usdc→life (Extra Life pot), Rhea swap, $1UP→ve (buybacks)
keeper ─▶ ve.snapshot ──▶ house.set_vote_shares
holder ──ft_transfer_call──▶ token ──ft_on_transfer──▶ ve           lock
anyone ──ft_transfer_call──▶ usdc/any FT ──▶ ve                     bribe, listing bond
```

## house

### Calls

| Method | Caller | Does |
|---|---|---|
| `ft_on_transfer(sender_id, amount, msg)` | USDC contract | `msg = ""` credits the sender's free balance; `{"seed":{}}` (owner) adds to pool and mints the seed Extra Life |
| `withdraw(amount)` | trader | sends free balance; refunds on failed transfer |
| `place_open(market_id, side, margin, leverage) → order_id` | trader | moves margin from free balance into the order; pre-checks solvency and capacity with the order counted |
| `place_close(position_id) → order_id` | owner | only after the 60 s minimum hold |
| `fill(order_id)` | anyone (keeper) | reads oracle; applies the fill rules in maths §2; opens or closes the position |
| `expire(order_id)` | anyone | after `FILL_WINDOW` with no valid price; refunds margin |
| `liquidate(position_id)` | anyone | latest price; pnl ≤ −0.9M → margin to pool |
| `take_profit(position_id)` | anyone | latest price; pnl at cap → close |
| `close_epoch(limit)` | anyone | resumable: first call freezes epoch `e` and starts `e+1` ("begun"); then mints Extra Lives `limit` per call ("minting"), waits for mints to land ("waiting for mints"), expires lives past their window ("expiring"), pays the pot and sets aside buyback USDC ("closed") |
| `set_vote_shares(epoch, shares)` | `ve` only | capacity + emission shares in force for `epoch` |
| `add_market(market_id, feed_id, max_leverage)` | `ve` only (listing), or owner before launch | |
| `claim_emissions(epochs)` | trader | $1UP earned as winner (by cut) and loser (by face) per maths §8 |

`market_id` is a short symbol (`"NEAR-USD"`); `side` is `"Long" | "Short"`.

### Views

`get_balance(account_id)`, `get_position(id)`, `get_positions(account_id)`, `get_orders(account_id)`,
`get_markets()`, `get_solvency()` → `{pool, liability, reserve, surplus, markets: [{id, long_liab,
short_liab, capacity}]}`, `get_epoch()` → `{id, started_at, ends_at, losses, payouts, close_state}`,
`get_pending_life(account_id)` → losses so far this epoch, `quote_open(market_id, side, margin, leverage)`
→ `{allowed, reason?, cut_rate, liq_price, max_profit}`, `get_claimable_emissions(account_id)`,
`get_params()`.

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
| `ft_on_transfer` from $1UP, `{"lock":{"epochs":n}}` | holder | mints a veNFT; `power = A × epochs_left / 52` |
| `ft_on_transfer` from any FT, `{"bribe":{"market_id":m}}` | anyone | bribe for the current epoch's voters of `m` |
| `ft_on_transfer` from USDC, `{"propose":{"market_id","feed_id"}}` | anyone, 500 USDC | listing proposal |
| `ft_on_transfer` from $1UP, sender `house`, `{"buyback":{"epoch","per_market":[…]}}` | `house` | voter rewards |
| `vote(token_id, allocations: [{market_id, ppm}])` | veNFT owner | persists until changed; Σ ppm = 1e6 |
| `snapshot(limit)` | anyone, after epoch close | sums votes for the next epoch, settles listings, calls `house.set_vote_shares` and `house.add_market` |
| `claim(token_id, epochs)` | veNFT owner | buyback $1UP + bribes |
| `unlock(token_id)` | veNFT owner | after the lock ends |

Votes for epoch `e` are those in force at the snapshot taken when `e−1` closed; voters of `e` earn `e`'s
buybacks and bribes. veNFTs are NEP-171 (transferable).

Views: `lock_info(token_id)`, `locks_for_owner`, `vote_shares(epoch)`, `claimable(token_id)`,
`bribes(epoch, market_id)`, `proposals()`.

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
