# OneUp

**Perps against a house that can't go bust. Lose a trade, get a life.**

OneUp is a perpetuals exchange on NEAR where every trade is against one USDC house pool, at the oracle
price, with no fees, funding or slippage. When you lose, you get an **Extra Life**: a capped, tradeable NFT
that earns USDC back from the house's real profit. Extra profit buys back **$1UP**, and people who lock $1UP
vote on which markets get the house's capacity and emissions.

Built at NEAR HACKATHON. Rust contracts on NEAR (near-sdk), a TypeScript keeper, bots and simulation, and a
Next.js app, all running on a local NEAR chain with one command.

## Run it

Needs Node 24, pnpm 10, and Rust with the wasm target and cargo-near (only to build the contracts):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
rustup target add wasm32-unknown-unknown
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh

pnpm install
pnpm demo
```

`pnpm demo` builds the contracts if needed, starts a local NEAR node (near-sandbox, like `hardhat node`),
deploys and wires all seven contracts, seeds the pool, then starts the keeper, six trading bots and the app
at **http://127.0.0.1:3020**. Epochs are 10 minutes. The app signs as a funded demo trader (switch to any
bot in the account menu). Chain state persists in `.localnet/`.

| Command | What it does |
|---|---|
| `pnpm demo` | Everything above, logs prefixed per process |
| `pnpm demo --lan` | Same, and serves the app to your Wi-Fi so you can use it on a phone (it hands out the localnet's throwaway keys, so only on a network you trust) |
| `pnpm stop` | Stops every OneUp process (and only those) |
| `pnpm localnet:reset` | Wipes the local chain for a fresh deploy |
| `pnpm test` | Contract unit + property tests, SDK and simulation tests |
| `pnpm test:sandbox` | Builds the wasm and runs end-to-end tests on a sandbox chain |
| `pnpm smoke` | Against a running demo: deposit → 50× long → fill → −2% → liquidation |
| `pnpm sim` | Re-runs the early-vs-late simulation |

Move a price during the demo:
`curl -XPOST localhost:8787/price -d '{"market":"NEAR-USD","movePct":-2}'`

## How the money moves

```mermaid
flowchart LR
  T[Traders] -- "losses, liquidations, winners' cut" --> P[(House pool<br/>USDC)]
  P -- "winners' profit (≤ 9× margin)" --> T
  P --> R{{"Reserve<br/>1.2× worst case,<br/>never below the seed"}}
  P -- "half the surplus<br/>above the reserve" --> S((Epoch payout))
  S -- 60% --> L[Extra Lives<br/>NFT holders]
  S -- 30% --> B[Buy back $1UP] --> V[ve1UP voters<br/>by market profit]
  S -- 10% --> P
  V -. "votes set each market's<br/>capacity + emissions" .-> P
  E[$1UP emissions] -- "50% winners by cut paid<br/>50% losers by loss" --> T
```

## The rules

**Trading.** USDC collateral, oracle price, leverage up to 100×. An order fills at the first oracle price
published *after* it was placed, within a 30-second window, never at a price already known, so nobody can
front-run the oracle. Minimum hold 60 s. A position can win at most 9× its margin. Winners pay a cut of
their profit: 10%, plus more for positions that use a big share of the pool (up to 25%). At a 90% loss a
keeper (anyone can run one) liquidates and the full margin goes to the pool.

**Solvency: the pool can always pay.** Every open position's maximum win is counted, longs and shorts
alike, and a trade that would push that total past the pool is refused. So there is never a payout queue.
Counting *both* sides matters: positions close at different times, so a long can take its max win after a
pump and a short opened at the top can take its own after a crash.
[`d1_spec_rule_can_go_bust`](contracts/house/src/tests.rs) shows the pool failing under the
"bigger side only" rule; a property test runs 200 random trading sequences and checks the pool always
covers every open position and no USDC is created or lost.

**Extra Lives.** At each epoch's end, the house's net result (losses taken − payouts made) is split among
that epoch's losers in proportion to their losses: that's each Extra Life's face value, so fake losses from
a long/short pair only create claims as big as the cut they paid. A life can earn up to *cap × face*; the
cap is 2.0× at an empty pool, falling to 1.2× at $1M. Lives are paid from 60% of half the surplus, pro rata
to what each is still owed (O(1) per claim via a product accumulator). A life earns for the epoch it's
minted in and 13 after, then stops and keeps what it earned. Lives are NEP-171 NFTs: sell one and its
unclaimed USDC goes with it.

**$1UP and ve1UP.** 1B fixed supply, minted once: 900M as emissions over 208 epochs (flat), 50M to seed a
spot pool, 50M treasury. No team or VC allocation. Each epoch's emissions are split across markets by vote
share, then half to winners by cut paid and half to losers by loss. Lock $1UP for 1–52 epochs as a veNFT;
votes decay linearly and decide each market's share of pool capacity and emissions. Voters earn their
markets' buybacks and any bribes. Anyone can list a market with a 500 USDC bond; it goes live at 2% of votes.

## Fair to late players

![Late losers get back as much as early ones](docs/fairness.svg)

The simulation ([`sim/`](sim/src/model.ts)) runs the same trader flows (three years of weekly epochs,
growing volume, 20 seeds) under OneUp's rules and Papertrade-style rules, with Papertrade's parameters
taken from its docs. Each loss is followed for a year.

| USDC back within a year per $1 lost | Weeks 1–39 | 40–78 | 79–117 | 118–156 |
|---|---|---|---|---|
| **OneUp** | 13.0¢ | 10.3¢ | 9.3¢ | 10.2¢ |
| OneUp without life expiry | 24.0¢ | 13.3¢ | 8.7¢ | 7.0¢ |
| Papertrade-style | 13.0¢ | 17.3¢ | 10.7¢ | 7.8¢ |

Year-1 losers take **0%** of year-3 payouts under OneUp, against **12%** under Papertrade-style rules,
where loss tokens earn forever. The middle row is OneUp as first specified: claims piled up faster than
they were paid, so later losers recovered less. Making lives expire after 13 epochs fixed it
([decision D-13](docs/decisions.md)).

## What's in the repo

| Path | What |
|---|---|
| [`contracts/house`](contracts/house) | Pool, orders, delayed fills, solvency, cut, liquidation, epoch close, emissions, buybacks |
| [`contracts/extra-life`](contracts/extra-life) | Extra Life NFTs (NEP-171), payout accumulator, expiry, claims |
| [`contracts/oneup-token`](contracts/oneup-token) | $1UP (NEP-141), fixed supply |
| [`contracts/ve`](contracts/ve) | veNFT locks, decaying votes (O(1) tallies), bribes, buyback rewards, market listing |
| [`contracts/math`](contracts/math) | Every formula, with the worked vectors from [`docs/maths.md`](docs/maths.md) |
| `contracts/mock-*` | Local-chain USDC with a faucet, a Pyth-compatible oracle, a constant-product swap |
| [`contracts/tests`](contracts/tests) | End-to-end tests on a sandbox chain |
| [`packages/sdk`](packages/sdk) | TypeScript port of the maths (same vectors) and typed contract calls |
| [`keeper`](keeper) | Pushes prices, fills, liquidates, takes profit at cap, closes epochs, runs buybacks |
| [`bots`](bots) | Six rule-based trading agents for demo volume |
| [`sim`](sim) | Early-vs-late simulation |
| [`app`](app) | Next.js app: trade, Extra Lives, vote, solvency, fairness |
| [`docs`](docs) | [Maths](docs/maths.md), [interfaces](docs/interfaces.md), [decisions](docs/decisions.md), [plan](PLAN.md) |

Tests: 75 contract unit and property tests, 5 end-to-end sandbox tests, plus SDK and simulation tests.
The sandbox tests found two real bugs during the build (a u128 overflow in voter reward splits and a
duplicate-registration panic), and running the demo found a third (the reserve floor; decision D-12).

## What's mocked locally

- **Prices** come from the keeper, which pushes a steerable random walk (or live Pyth prices with
  `--prices hermes`, which needs a `PYTH_API_KEY`: Hermes now refuses unauthenticated requests) to a
  Pyth-compatible oracle. Markets listed by vote are priced automatically. On mainnet the house points at Outlayer's
  `price-oracle-pyth.near` with the same calls. Outlayer's testnet feed was stale when checked.
- **USDC** is a local token with a faucet. **Buybacks** swap on a local constant-product pool standing in
  for Rhea.
- **NEAR Intents** deposits aren't integrated: Intents has no testnet or local deployment.
- Buybacks are triggered by the owner key for now, so nobody can sandwich them with a zero minimum
  (decision D-10).

See [`docs/decisions.md`](docs/decisions.md) for every design decision and known limit.
