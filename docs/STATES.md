# OneUp's states

These are the things in OneUp that move through stages, each with one named type and one function that decides its
stage. Read the type before branching on a stage, and add a stage there rather than combining flags at the call site.
The list is what has been named so far, not a proof that nothing else has stages (see the end).

| What | Stages | Where |
|---|---|---|
| A round | `loading` → `open` → `ending` → (next round) `open` | `roundPhase`, [packages/sdk/src/round.ts](../packages/sdk/src/round.ts) |
| Closing a finished round (keeper) | `CloseStep`: `waiting for backing`/`waiting for pot` → `begun` → `minting`, `expiring`, `recalling`, `drawing jackpot` and their `waiting`/`retrying` steps → `closed` | `CloseStep`, the same file; the contract is `close_epoch` in [contracts/house/src/epochs.rs](../contracts/house/src/epochs.rs) |
| A pending order | `waiting` (market open or close) or `resting` (limit open) → filled, or `expiring` once its window is over | `orderStage`, [packages/sdk/src/orders.ts](../packages/sdk/src/orders.ts) |
| Loading the app | `loading` → `ready`, or `failed` | `Load`, [app/src/lib/oneup.tsx](../app/src/lib/oneup.tsx) |
| Who's using the app | `local`, `watching`, `connected` | `accessOf`, [app/src/lib/access.ts](../app/src/lib/access.ts) |
| The NEAR wallet | `unavailable`, `disconnected` → `connecting` → `connected` → `signing` → `confirming` → `connected`; `disconnecting` | `WalletStatus`, [app/src/lib/near-wallet.ts](../app/src/lib/near-wallet.ts); the steps of a request come from `walletSender` in [wallet-send.ts](../app/src/lib/wallet-send.ts) |
| A transaction's toast | `pending` → `ok` or `error` | `Toast`, [app/src/lib/oneup.tsx](../app/src/lib/oneup.tsx) |
| A Life NFT | `earning` → `expired`, `fully-allocated` or `awaiting-settlement` | [app/src/lib/life-economics.ts](../app/src/lib/life-economics.ts) |
| Your next step with Life NFTs | `loading`, `claim`, `earning`, `pending`, `finished`, `empty` | `recoveryStep`, [app/src/lib/recovery-journey.ts](../app/src/lib/recovery-journey.ts) |
| The power-on screen | `boot` → `leaving` → `gone` | [app/src/components/Boot.tsx](../app/src/components/Boot.tsx) |

The round's stage comes from the round's start, the deployment's round length and the reader's clock, not from the
chain's block time, so it is an estimate to within a few seconds. `ending` lasts until the keeper's `close_epoch`
starts the next round; trades still count towards the ending round until then.

## For agents (the MCP server)

- `account` → `round.phase` (`open` with `round.seconds_left`, or `ending` with `round.note`), and each of
  `pending_orders[].stage` (`waiting` or `resting` with `expires`, or `expiring` with `expired` and `note`).
- `house` → `round_phase`, beside `round` and `round_ends`.

## Not named yet

- Backing the house: `get_backing().open` is false both when the funding round is full and while it is paused (a
  round settling, or another backing being processed). The Backing tab tells the two apart by whether less than the
  minimum is left ([app/src/components/Backing.tsx](../app/src/components/Backing.tsx)).
- Polled reads (`usePoll`, and fetches that keep retrying) treat "no value yet" as loading. They have no failed stage
  because they retry on the next poll.
- The simulated cross-chain deposit's steps (local demo only) are progress text, not a type.
