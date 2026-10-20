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

### Stage 2 — Epochs + Extra Lives (3–5 Nov)

- [ ] Epoch close (permissionless after epoch end): house net result, losers' share, reserve, surplus
- [ ] Mint one Extra Life per losing wallet per epoch, face value pro rata to losses; cap 2.0× → 1.2× at $1M
- [ ] Surplus payout ≤ 50%: 60% Extra Lives (pro rata to owed), 30% buyback bucket, 10% pool; 60% rolls to
      buybacks when nothing is owed
- [ ] Claim; Full Heal state at cap; NEP-171 transfer keeps claim with the token
- [ ] Seed Extra Life (1.0× cap) minted to the seed provider
- [ ] Tests against `docs/maths.md` vectors

**Gate 2:** a scripted multi-epoch scenario settles exactly to the maths vectors.

### Stage 3 — $1UP, ve, bribes (5–7 Nov)

- [ ] `oneup-token`: 1B fixed supply, 900M emissions over 208 epochs, 5% Rhea seed, 5% treasury
- [ ] Emissions: by market vote share, then 50/50 winners (by cut paid) / losers (by face value)
- [ ] `ve`: lock 1–52 weeks as veNFT, linear decay, per-epoch vote allocation across markets
- [ ] Vote shares feed house capacity split + emissions split
- [ ] Bribe boxes paid to a market's voters at epoch end; 30% buyback paid to voters by market profit

**Gate 3:** full epoch cycle (trade → close epoch → emissions → vote → capacity change) passes in sandbox.

### Stage 4 — Buybacks + listing (7–8 Nov)

- [ ] Buyback swap USDC → $1UP on Rhea (testnet pool seeded); fallback: mock swap at a fixed price
- [ ] Market proposal with $500 bond; live at ≥ 2% votes; bond to treasury after 4 epochs with no votes

**Gate 4:** contracts feature-complete; deploy all to testnet (target 8 Nov, hard stop 11 Nov).

### Stage 5 — SDK, keeper, API (5–9 Nov, parallel with 3–4)

- [ ] `packages/sdk`: typed bindings + shared maths, tested against the same vectors as the contracts
- [ ] `keeper`: price push, fill pending orders, scan + liquidate, close epochs; idempotent, restart-safe
- [ ] `api`: index contract events → SQLite; endpoints for trades, epochs, pool/solvency series, Extra Lives

### Stage 6 — Web app (6–10 Nov)

- [ ] Wallet selector login, deposit/withdraw
- [ ] Trade screen: market list, price, open/close, pending fill state, PnL, liquidation price
- [ ] Extra Lives: face value, cap, paid so far, bar to Full Heal, claim
- [ ] Lock + vote: veNFTs, vote allocation, bribes, propose market
- [ ] Solvency dashboard: pool, reserve, worst-case payout vs pool, per-market capacity

### Stage 7 — Simulation (9–11 Nov)

- [ ] `sim`: agent-based run with shared maths; early vs late traders, OneUp vs Papertrade-style rules
- [ ] Charts exported for the app and README; sim also used to sanity-check parameters

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
