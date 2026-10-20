# OneUp POC — staged build plan

Spec: The original OneUp spec (source of truth for mechanics and parameters).

**POC = the 2-minute demo script running end to end on NEAR testnet**, with 10-minute epochs and demo bots
trading in the background, plus tests for the solvency, Extra Life and emissions maths and one command that
runs it all. Submission deadline: 14 Nov 2026, 23:59 UTC.

## Repo layout

```
contracts/            Rust cargo workspace (near-sdk)
  house/              pool, orders, delayed fills, positions, solvency, cut, liquidation, epochs
  extra-life/         NEP-171 Extra Life NFTs: face value, cap, paid so far, claim
  oneup-token/        NEP-141 $1UP + emissions minter
  ve/                 veNFT locks, votes, bribe boxes, market listing
  mocks/              mock USDC (NEP-141) and mock oracle (Pyth-style calls) for tests + fallback
  tests/              near-workspaces integration tests
packages/
  sdk/                TS bindings for every contract + shared maths (cap curve, cut, solvency) used by app/api/sim
keeper/               TS bot: push prices, fill delayed orders, liquidate, end epochs
api/                  TS indexer + read API: positions history, epoch results, pool/solvency series, leaderboards
app/                  Next.js + NEAR wallet selector: trade, Extra Lives, lock + vote, solvency dashboard
sim/                  TS simulation: early vs late traders, OneUp vs Papertrade-style rules → charts
bots/                 demo trading agents on testnet accounts
scripts/              deploy, seed, `demo` one-command runner
docs/                 interfaces, maths spec, test vectors, decisions
```

The API is not in the spec: the app can read contract views directly, but history (closed trades, epoch
results, pool over time) needs an indexer. Kept thin; the app must still work from views alone if it slips.

## Stages

Each stage ends with a gate. Nothing in a later stage starts on a contract until the gate before it passes.

### Stage 0 — Design freeze (20–31 Oct) · docs only

Spec open question: code written before 1 Nov may not be allowed. Until confirmed, this stage writes **no
implementation code**.

- [ ] Confirm the pre-1-Nov code rule (site has no explicit rule; "Build your project during the hackathon")
- [x] Toolchain: Rust 1.99.1 + `wasm32-unknown-unknown`, cargo-near 0.22.0, near-cli-rs 0.30.1, pnpm
      (near-workspaces comes in as a crate dependency)
- [ ] Testnet accounts: deployer, seed provider, keeper, 6–10 bot accounts
- [x] `docs/interfaces.md` drafted
- [x] `docs/maths.md` drafted with test vectors V1–V7
- [x] Oracle on testnet: stale → own Pyth-compatible oracle fed from Hermes (D-6)
- [x] NEAR Intents: key optional, mainnet only (D-7)
- [x] Testnet USDC: Circle's exists; mock for demo volume (D-8)
- [ ] Decide D-1 … D-9 in `docs/decisions.md`
- [ ] Team roles: contracts, app, simulation, video

**Gate 0:** D-1 … D-9 decided, interfaces + maths frozen.

### Stage 1 — House core (started 20 Oct) · ✅ done, gate passed

Built with the recommended defaults for D-1 … D-9 (switchable: `Params.solvency_both_sides`).

- [x] Cargo workspace (`contracts/`), `oneup-math` crate with V1–V7 + property tests (11 tests)
- [x] `mock-usdc` (NEP-141, faucet) and `mock-oracle` (Pyth-compatible, keeper-pushed)
- [x] Deposit via `ft_transfer_call`, owner seed, withdraw with refund on failure
- [x] Orders → delayed fills: price must be newer than the order, inside the 30 s window, ≤ 60 s old,
      conf ≤ 1%; `expire` refunds
- [x] Positions: long/short, leverage ≤ market max, 60 s min hold, 9× profit cap, winner's cut
- [x] Liquidation at 90% loss and take-profit at cap, by any keeper; pending close cancelled
- [x] Solvency rule (both sides, D-1) + per-market capacity on every open; `quote_open` explains refusals
- [x] Epoch counters (losses, payouts, cuts) and per-wallet pending Extra Life
- [x] 18 house unit tests incl. a property test (200 random sequences: USDC conserved, pool ≥ liability)
      and `d1_spec_rule_can_go_bust`, which shows the spec's rule failing
- [x] Sandbox integration test on the real wasm: deposit → open → oracle fill → liquidate → withdraw

Run: `cd contracts && cargo test -p oneup-math -p oneup-house` · `./build.sh && cargo test -p oneup-integration`

### Stage 2 — Epochs + Extra Lives · ✅ done, gate passed

- [x] `close_epoch(limit)`: permissionless, resumable (begun → minting → waiting for mints → closed);
      trading never pauses
- [x] One Extra Life per losing wallet per epoch, face pro rata to losses, cap 2.0× → 1.2× at $1M
- [x] Payout ≤ 50% of surplus above the reserve: 60% Extra Lives (capped at what's owed, rest to
      buybacks), 30% buyback USDC (held for stage 4), 10% stays
- [x] `extra-life` contract: NEP-171 + metadata + enumeration + approvals; token id `<epoch>:<owner>`;
      O(1) pro-rata payout via a product accumulator with rescaling; claim; unclaimed USDC moves with the token
- [x] Seed Extra Life (1.0× cap) minted on seed
- [x] Tests: 12 extra-life (incl. never-overpays property), 22 house (hand-worked epoch, house-loses
      epoch, epoch closes inside the random-sequence property test); sandbox `lose_close_epoch_claim`

### Stage 3 — $1UP, ve, bribes · ✅ done, gate passed

- [x] `oneup-token`: NEP-141, 1B fixed supply minted once (900M house, 50M Rhea seed, 50M treasury)
- [x] House emissions: per-epoch split by vote share, then 50/50 winners (by cut) / losers (by loss,
      ∝ face) per market; unearnable market emissions → treasury; `claim_emissions(epochs)`
- [x] `ve`: veNFT locks (NEP-171), 1–52 epochs, linear decay; O(1) per-market totals via sums +
      scheduled expiries; votes count from next epoch and persist
- [x] House → `ve.checkpoint(e)` at each epoch start → `house.set_vote_shares` sets market capacity
- [x] Bribe boxes (any NEP-141, for next epoch's voters) and buyback rewards by market; claims handle
      late-arriving rewards; failed transfers kept as owed
- [x] Tests: 13 ve (incl. tally = direct-sum property), 3 new house, 2 token; sandbox
      `trade_vote_emissions_capacity` (vote → capacity, emissions claimed in $1UP)

### Stage 4 — Buybacks + listing · ✅ contracts done; testnet deploy pending

- [x] `mock-swap` (x·y=k, 0.3% fee) standing in for Rhea; pays out with `ft_transfer_call`
- [x] House buyback: per-epoch USDC + market weights (positive house profit, else vote shares) →
      `buyback(epoch, min_out)` (owner, D-10) → proceeds forwarded to `ve` for that epoch's voters
- [x] Listing in `ve`: 500 USDC bond; listed at ≥ 2% of votes (house `add_market`, then shares, in
      order), bond refunded; 4 idle checkpoints → bond to treasury
- [x] 256-bit `mul_div` in `oneup-math` for every pro-rata split (the sandbox caught a u128 overflow
      in ve reward claims)
- [x] Sandbox `listing_and_buyback_to_voters`: propose → vote → listed; loss → buyback → swap → voter claims
- [x] ~~Testnet deploy~~ dropped: everything runs on a local NEAR chain (`pnpm localnet`)

### Stage 5 — Localnet, SDK, keeper, API

- [x] `pnpm localnet`: persistent local NEAR node (near-sandbox, like `hardhat node`) in `.localnet/`,
      bound to 127.0.0.1; on a fresh chain deploys and wires all 7 contracts, lists NEAR/BTC/ETH, seeds a
      1M USDC pool and the swap, funds the keeper, 6 bots and a demo trader; writes `localnet.json`
- [x] `packages/sdk`: bigint port of `oneup-math` (same vectors), typed views and calls for every contract
- [x] `keeper`: sim (steerable random walk) or live Pyth Hermes prices; fills/expires orders, liquidates,
      takes profit at cap, steps epoch closes, runs buybacks; control port for demo price moves
- [x] `pnpm smoke`: deposit → 50x long → keeper fill → price −2% → keeper liquidation, on localnet
- [ ] `api`: index events → SQLite; trades, epochs, pool/solvency series

### Stage 6 — Web app (`app/`, Next.js 16, port 3020)

- [x] Dev wallet on localnet: signs in the browser with `localnet.json` keys; switch demo trader / bots
      (NEAR wallet selector can't reach a local chain; it's the path for a real network)
- [x] Header: pool, epoch countdown, free balance, wallet USDC/$1UP, faucet, deposit, withdraw
- [x] Trade: markets with live oracle prices, price chart with entry/liquidation lines, order form with
      the contract's own quote (cut, liq price, refusal reason), positions with live PnL and min-hold countdown
- [x] Extra Lives: pending life this epoch, NFT cards (face, cap, owed, paid, progress to Full Heal), claim
- [x] Vote: vote shares now → next epoch, lock $1UP, per-lock vote allocation, claim buybacks/bribes,
      propose a market (500 USDC bond), bribe voters
- [x] Solvency: worst case vs pool vs reserve, per-market longs/shorts vs capacity (colour-blind-safe
      pair, validated), epoch history table
- [ ] Demo polish pass once bots and the simulation exist

### Stage 7 — Simulation + bots

- [x] `bots/`: 6 rule-based agents (degen, trend, fader, whale, scalper, voter) trading on localnet,
      topping up, claiming Extra Lives / emissions / voter rewards, locking and voting (`pnpm bots`)
- [x] `sim/`: OneUp vs Papertrade-style (parameters from Papertrade's docs) on the same seeded flows;
      recovery per $1 lost by cohort over equal windows, late-period payout capture (`pnpm sim`)
- [x] Finding D-13: as written, late losers recovered less; lives now expire after 13 epochs (contracts,
      house expiry step, sim default). Recovery is ~flat (13.0¢ → 10.2¢); year-1 losers take 0% of year-3
      payouts vs 12% Papertrade-style
- [x] Fairness view in the app (median of 20 seeds, validated palette, table view)
- [ ] Simulation chart in the README

### Stage 8 — Intents, testnet, bots (10–12 Nov)

- [ ] NEAR Intents 1Click deposit/withdraw in the app (fallback: testnet faucet button)
- [ ] Demo bots trading on testnet; 10-minute epochs live
- [ ] Dry-run the demo script end to end at least twice

**Gate 8 (11 Nov):** demo script runs on testnet. Anything not working by now is cut, not fixed.

### Stage 9 — Ship (12–14 Nov)

- [ ] README: pitch, money-flow diagram, architecture, how solvency works, test commands, `pnpm demo`
- [ ] Record the 2-minute video, X post
- [ ] Submit by 14 Nov 23:59 UTC

## Cut lines (in order, if a gate slips)

1. Voting on cut / leverage (already stretch), risk dial (already stretch)
2. NEAR Intents → faucet / mock USDC deposit
3. Rhea buyback → mock swap at fixed price
4. Market listing bonds → admin-listed markets
5. API → app reads contract views only
6. Bribes

Never cut: solvency rule, delayed fills, Extra Life sizing + cap, epoch settlement, tests for those maths.
