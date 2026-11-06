# Security

What OneUp trusts, what each key can do, what reviews of the code found (21 Oct 2026, 23 Oct 2026 and
31 Oct 2026) and what changed, and what is still open. Decisions are in [decisions.md](decisions.md); the maths in [maths.md](maths.md).

This is a hackathon proof of concept running on a local chain. It hasn't been audited. Don't put real money
in it.

## The invariants

These hold for every sequence of actions, and property tests check them after every step of random
sequences of opens, closes, fills, liquidations, triggers, backings, expiries and epoch closes
([`conservation_and_solvency`](../contracts/house/src/tests.rs)):

- **No USDC is created or lost.** The house holds exactly pool + free balances + pending and open margins
  + buyback USDC + pending backing + what it has sent to Life NFTs.
- **The pool covers every open position's max win** (D-1): liability ≤ pool, and the epoch payout never
  takes the pool below 1.2 × liability or below the total seeded.
- **Liability is the sum of the markets'**, kept in step on every open, fill, expiry and close.
- **Epoch net losses** equal the sum over wallets of max(0, losses − profit paid) (D-24).

The maths crate's property tests cover the rest: PnL is bounded to [−margin, 9 × margin] and rounds
against the trader; a settlement conserves USDC and the winner's cut rounds up; the epoch payout never
touches the seed; a Backer Life's cap stays on the curve, falls as the pool grows, and splitting a backing
gains at most 2 ppm. The Life NFT crate's property test checks that claims never send more than the pots
received and no life claims more than it was paid.

## Who can do what

| Role | Account on localnet | Can | Can't |
|---|---|---|---|
| Owner | Sputnik DAO (D-20) | House: list, pause and size markets; set the oracle, swap, params, keeper, operator, Intents Verifier; hand over ownership. Life NFTs: point them at another house (`set_house`). Oracle: choose who pushes prices (`set_pusher`). The DAO is also the locks contract's owner, which has no owner-only methods | Touch traders' balances or positions directly |
| Operator | root | Run buybacks and retry delivery; fill, take profit at cap, and deploy pool capital through the shared keeper gate | Owner-only configuration |
| Keeper | `keeper.test.near` | Fill orders, take profit at the 9× cap (D-23); push prices through a separate key that can only call the oracle; deploy pool USDC to the vault up to the contract's limit (D-27) | Pick a fill price older than the order or outside the window; move funds anywhere but the vault |
| Anyone | – | Liquidate, place a close for a crossed trigger, expire a stale order, close an epoch, back the pool | Fill an order or take profit while a keeper is set |
| NEAR Intents Verifier | `intents.test.near` | Deposit USDC naming the account it's for (D-21) | Open a trade larger than the deposit it brings |
| Session key | browser | Open, close and set triggers on the house, with no deposit (gasless through the relayer) | Deposit, withdraw or move tokens |

Contract accounts have no access keys after deploy (`scripts/deploy.ts` deletes them), so no access-key holder can redeploy those accounts. Vendored contracts may have their own administrative methods, which are not established absent merely by deleting keys. Each account the deploy creates has its own key. The browser gets only the demo
trader's and the bots' keys (`/api/config`); the root, keeper and solver keys stay on the server.

### Trust assumptions

- **The oracle.** Prices decide every settlement. On localnet the keeper pushes Binance prices (Coinbase as
  fallback) into a Pyth-compatible mock; on mainnet the house would read Outlayer's Pyth oracle. The house
  checks each price's age (60 s), its confidence (when the feed reports one) and that it isn't more than
  5 s in the future, and the mock oracle only accepts a newer price than the last. A wrong price is still
  a wrong settlement.
- **The yield vault** (D-27) holds most of the pool between rounds. If it failed, the house couldn't pay out what's
  deployed: the contract keeps 1.2× the worst case plus 10% on hand, but the vault's own safety is a trust
  assumption. External USDC lending is planned, not implemented; the local vault is a mock chosen by the owner/DAO.
- **The jackpot draw** uses NEAR's block random seed, which a validator could bias slightly.
- **The keeper** is trusted to fill promptly (D-23). The contract requires a price published after the order and within its window; it does not establish that the first valid price was used. The keeper can delay within that window or let an order expire. Older prices are rejected.
- **The owner** can change the oracle, the swap contract and the params, so it can take funds. That's why
  a DAO owns the house, the Life NFTs and the oracle; on mainnet the DAO's council and voting period are the
  protection. The mocks of outside services (USDC, the swap, the vault) stay with the root account locally.

## Review findings (21 Oct 2026) and what changed

Three reviews ran in parallel: the house and maths, the NFT, lock, market and token contracts, and the
off-chain code (API routes, keeper, deploy). Every finding below has a test that failed before the fix.

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | High | A trigger could be set at any price and settled at the price that crossed it, so a trader could close whenever the on-chain price lagged the market in their favour | A hit places a close that fills at the next price (D-19) | `trigger_at_any_price_cannot_close_at_a_known_price`, sandbox `back_the_pool_then_trade_with_a_keeper`, property `conservation_and_solvency` (Trigger op) |
| 2 | High | An Intents deposit could open a max-leverage trade with the named account's whole balance | An Intents open trades only the USDC it brought (D-21) | `intents_open_trades_only_the_deposit` |
| 3 | High | A closed lock (exited, unlocked or merged) kept its market approval, so the market could sell an empty lock | Closing a lock removes its approvals; a closed lock can't be approved or transferred | `exited_lock_cannot_be_sold_through_a_stale_approval` and 5 more in ve, sandbox `a_listing_cannot_change_under_the_buyer` |
| 4 | High | One key for every account, handed to the browser: anyone with the demo key could redeploy the house or push prices | A key per account; contract accounts' keys deleted; `/api/config` serves only the demo and bot keys | deploy, `app/test/config.ts` |
| 5 | High | `/api/config` served the root, keeper and solver keys | As above | `app/test/config.ts` |
| 6 | Medium | Anyone could fill an order with any price in the 30 s window, and let it expire for free | Keeper-only fills (D-23) | `only_the_keeper_fills_once_set`, `only_the_keeper_takes_profit_at_the_cap` |
| 7 | Medium | Lives and $1UP went by gross loss: a long and a short on yourself took most of an epoch's lives | Net loss per wallet (D-24) | `wash_trading_counts_only_the_net_loss` |
| 8 | Medium | A seller could claim a listed NFT's earnings or re-price it before a buy landed | Claims drop the listing; a buy carries the price it saw and is refunded if it changed. *Only half fixed: a claim followed by a new listing at the same price still passed; closed on 31 Oct, row A below* | `claim_drops_the_approvals`, `claiming_drops_the_approvals`, `a_reprice_under_the_buyer_fails` |
| 9 | Medium | 1-yocto locks drained ve's storage balance | User locks need at least 1 $1UP | `dust_locks_are_refused` |
| 10 | Medium | The RPC proxy forwarded any method, including the sandbox's `sandbox_patch_state` | Method allowlist, 64 KB cap | `app/test/rpc.ts` |
| 11 | Medium | The price control server took cross-site requests from any web page | JSON only, no `Origin`, prices bounded | `keeper/test/prices.ts` |
| 12 | Medium | The indexer believed `oneup` events from any contract | Only the house's and the market's | `app/test/activity.ts` |
| 13 | Medium | Server routes would sign against any RPC | `assertLocalnet`, Host check on every route, bridge capped per call | `app/test/config.ts` |
| 14 | Low | Dust deposits created balance entries paid for by the house | A new balance needs the minimum margin | `dust_cannot_open_a_balance`, `intents_dust_cannot_open_a_balance` |
| 15 | Low | A partial buyback swap could be swapped again | The rest goes back to the pool | `a_partial_buyback_is_not_swapped_twice` |
| 16 | Low | A refused life pot cleared what lives were owed | Refused = still owed | `a_refused_pot_is_still_owed` |
| 17 | Low | Changing the solvency rule with pending orders could freeze them | Refused while orders are pending | `solvency_rule_cannot_change_with_pending_orders` |
| 18 | Low | Life NFT claims could record more than they sent; a failed claim restored the wrong tokens | Record only what's sent; restore each token's own amount; 30 per call | `claim_never_records_more_than_it_sends`, `failed_claim_restores_exactly_its_amounts` |
| 19 | Low | A second seed from the owner was silently not owed | Backer Lives have their own ids | `the_owner_can_seed_twice`, `one_owner_can_back_twice` |
| 20 | Low | The solver's fill check allowed a free 1% and odd payloads; the relay had no gas cap or rate limit | Exact checks, one fill at a time; 100 Tgas cap, 10 per 10 s | `app/test/fill.ts`, `app/test/relay.ts` |
| 21 | Low | The keeper stamped prices after fetching, and one missing market stopped every push | Stamp before the fetch; skip bad markets; drop NaN, zero and isolated >20% jumps (sustained jumps accepted after ten rejected ticks) | `keeper/test/prices.ts` |

## Review findings (31 Oct 2026) and what changed

A review of a fresh clone, done the way the hackathon's AI screeners and a judge would read it, found four
medium-severity issues. None changes a contract's state layout.

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| A | Medium | A buy was bound only to the price: a seller could claim a listed Life's USDC (which drops its approvals) and list it again at the same price, and a purchase already in flight paid for the emptied Life | A buy names the listing's `approval_id` too; a new listing has a new one, so the buyer is refunded | `a_relist_at_the_same_price_under_the_buyer_fails`, `buy_needs_the_approval_id`, sandbox `a_life_claimed_and_listed_again_is_not_sold_to_the_earlier_buyer` |
| B | Medium | Marketplace fees count as house profit and Lives are sized by share of it, so in a quiet round a $1 loss minted a Life worth all the round's fees, plus the round's whole $1UP release | Lives and $1UP are sized from house profit up to the round's net losses (`recovery_base`); a face is never more than its loss. The rest stays in the pool and the unreleased $1UP carries | `fees_cannot_make_a_life_worth_more_than_its_loss`, `a_quiet_rounds_fees_dont_inflate_its_lives`, SDK previews |
| C | Medium | A limit order priced through the market could be cancelled at once: a market order with a cancel button, the free option D-30 refuses market orders | A limit order rests for one fill window (30 s) before it can be cancelled, so a marketable one fills first | `limit_cannot_be_cancelled_inside_the_fill_window`, `a_marketable_limit_fills_before_it_can_be_cancelled` |
| D | Medium | The DAO owned only the house: the root account kept the Life NFTs (`set_house`, which decides who mints and pays them) and the oracle (`set_pusher`) | The local deployment makes the DAO their owner at init, and `test:judge` checks it | `only_the_owner_repoints_the_house`, `once_repointed_the_old_house_cannot_mint`, `pnpm test:judge` (DAO ownership) |

Still open from that review: a resting limit order can be pulled once its first 30 seconds are up, so a trader
who sees the market moving toward it can cancel before the oracle catches up (a cancel that takes effect a fill
window later would close this); resting limits hold margin and pool room for up to 24 hours at no cost; the
locks' and Lives' value-moving methods don't require a 1-yoctoNEAR deposit; no sandbox test yet covers a DAO
proposal, a jackpot draw, limit orders or 1000× leverage.

## Known and accepted

- **Splitting a position lowers the winner's cut** (cut is sized by the position's own liability, not the
  market's). Ten small positions pay ~10% instead of up to 25%. It's a fee question, not a solvency one.
- **Failed issuance retains its entitlement.** Life and lock batches persist on-chain and are retried
  by `close_epoch` or permissionless `retry_recovery`. Receiver idempotence and attempt guards prevent
  duplicate issuance; debt remains owed and settlement waits for confirmation. Permanent destination
  failure can still delay settlement. Backer lock reservations use the same queue. See [recovery](RECOVERY_JOURNEY.md).
- **Buyback delivery is tracked.** Rejected or failed deliveries retain the refunded amount for
  `retry_buyback_delivery(epoch)` by the owner or operator; in-flight retries are refused.
- **Ownership hands over in one step** (`set_owner`). A typo loses the house; propose-and-accept is the fix.
- **House-issued lock epochs are explicit.** Recovery retries checkpoint to the preserved creation
  epoch before minting, so checkpoint timing cannot move these entitlements. Ordinary user-created
  locks still use ve's current checkpoint; delayed keeper checkpoints remain an operational risk.
- **Claiming a lock built from many merges walks the whole merge tree** per epoch; claim fewer epochs per
  call.
- **Stale market listings stay listed** until someone tries to buy (who is refunded in full).
- **Localnet only:** the bridge is simulated; the relayer and bridge are the root account; the demo and bot
  keys are in every browser by design (anyone on your Wi-Fi can trade as them when `pnpm demo --lan` runs).

## Running the checks

```bash
pnpm test           # contract unit/property, SDK and simulation tests
pnpm test:sandbox   # builds WASM and runs integration tests on fresh sandbox chains; see run output for count
pnpm test:ts        # API route, keeper, indexer and UI-helper regressions
```

## Follow-up review and remediation, 23 October 2026

The first-party repository was reviewed with Security Scan and the five Spec Reviewer dimensions.
The scan is source-based; third-party WASM internals, installed dependency source and live advisory
verification are excluded. It does not establish mainnet readiness.

Confirmed issues addressed in source include insufficient marketplace settlement gas, keeper first-page
order starvation, backing/expiry debt races, and unbounded jackpot draw/cleanup. Marketplace admission
now reserves explicit downstream gas before NFT transfer. The keeper snapshots every order page before
mutating orders. Backing stays pending until its mint succeeds; its reward allocation is reserved and
only delivered on success. Closing waits for earlier debt-mutating transfer chains. Jackpot work is
bounded across resumable close calls. Partial life-pot refunds restore debt rather than clearing it.

Regressions cover insufficient/ordinary buyer gas with fees enabled, >200 resting limits, pending and
failed backing, debt snapshot serialization, bounded jackpot work and later harvests, buyback refund/retry,
RPC failure/retry, and net-profit ranking. UI/model regressions cover wallet net-loss previews, negative
profit epochs, lock cursors through filtered and exact-boundary pages, post-schedule carry reporting,
late buybacks, exact trigger prices, revocation recovery, and poll cancellation.
Vault recall and full epoch batches are exercised on fresh sandbox chains.

These source changes alter House/Closing state layouts and add NFT views. Existing localnet deployments
are reused on restart and have no access keys for redeployment. Use a separately created fresh sandbox
to validate new bytes; recreating an existing demo is an explicit operator action, not an automatic reset.


## Native wallet and testnet preparation

The opt-in testnet profile uses an allowlisted keyless config and NEAR Connect 0.11.4 for
wallet-approved transactions. Meteor is recommended; the picker filters for compatible testnet wallets
and excludes MyNearWallet ahead of its [announced 31 October 2026 deprecation](https://www.mynearwallet.com/sunset).
No access key is requested at connection. Local demo signing, relay, bridge and indexer APIs are disabled
under that profile; testnet reads go directly to the configured RPC. The local session-key feature is
not available in testnet mode. The connector's wallet manifest and adapter origins remain upstream trust
boundaries; iframe isolation is not an audit guarantee. Wallet connection is not evidence of an external
deployment or a verified transaction journey.

`scripts/deploy-testnet.ts` defaults to an offline plan. Explicit execution later requires a named testnet
operator, a matching owner-only credential file, an approved HTTPS RPC and an unused account namespace.
It checks the network and balance, deploys/initializes atomically, journals transactions and removes
contract deployment keys after setup. Private operator/recovery files stay in ignored `.testnet/` with
restricted permissions; only the allowlisted public profile can be passed to the app. Partial setup needs
manual inspection, not blind replay. See [setup and verification limits](NEAR_WALLET_SETUP.md).

This profile retains a privileged operator and keeper, unrestricted test-token minting and mock economic
boundaries. It deploys no DAO, Intents bridge or external lending integration. Test-only assets and setup
budgets must not be confused with customer deposits or fundraising. A real-wallet testnet journey remains
unverified until an account is supplied and the acceptance sequence is actually completed.
