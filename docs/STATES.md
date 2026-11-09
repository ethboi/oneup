# OneUp's states

Each thing in OneUp that moves through stages has one named type and one function that decides its stage. Read the
type before branching on a stage, and add a stage there rather than combining flags at the call site.

| What | Stages | Where |
|---|---|---|
| A round | `loading` → `open` → `ending` → (next round) `open` | `roundPhase`, [packages/sdk/src/round.ts](../packages/sdk/src/round.ts) |
| Closing a finished round (keeper) | `CloseStep`: `waiting for backing`/`waiting for pot` → `begun` → `minting`, `expiring`, `recalling`, `drawing jackpot` and their `waiting`/`retrying` steps → `closed` | `CloseStep`, the same file; the contract is `close_epoch` in [contracts/house/src/epochs.rs](../contracts/house/src/epochs.rs) |
| Loading the app | `loading` → `ready`, or `failed` | `Load`, [app/src/lib/oneup.tsx](../app/src/lib/oneup.tsx) |
| Who's using the app | `local`, `welcome`, `watching`, `connected` | `accessOf`, [app/src/lib/access.ts](../app/src/lib/access.ts) |
| The NEAR wallet | `unavailable`, `disconnected` → `connecting` → `connected` → `signing` → `confirming` → `connected`; `disconnecting` | `WalletStatus`, [app/src/lib/near-wallet.ts](../app/src/lib/near-wallet.ts); the steps of a request come from `walletSender` in [wallet-send.ts](../app/src/lib/wallet-send.ts) |
| A transaction's toast | `pending` → `ok` or `error` | `Toast`, [app/src/lib/oneup.tsx](../app/src/lib/oneup.tsx) |
| A Life NFT | `earning` → `expired`, `fully-allocated` or `awaiting-settlement` | [app/src/lib/life-economics.ts](../app/src/lib/life-economics.ts) |
| Your next step with Life NFTs | `loading`, `claim`, `earning`, `pending`, `finished`, `empty` | `recoveryStep`, [app/src/lib/recovery-journey.ts](../app/src/lib/recovery-journey.ts) |
| The power-on screen | `boot` → `leaving` → `gone` | [app/src/components/Boot.tsx](../app/src/components/Boot.tsx) |

Agents see the round's stage too: the MCP server's `account` and `house` tools report `phase`, and once a round is
`ending` its trades still count towards it until the keeper starts the next round.

Polled reads (`usePoll`, and fetches that keep retrying) treat "no value yet" as loading. They have no failed stage
because they retry on the next poll.
