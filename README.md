# OneUp

**Lose a trade, get a life. Capped-payout perps with tradable recovery NFTs on NEAR.**

OneUp is a local-chain prototype for traders interested in partial recovery after losses. Trade against a
USDC house pool → eligible net losses in a profitable round create an **Extra Life** → claim USDC allocated
from future house profit → transfer the NFT and its unclaimed USDC to a buyer. Recovery can be zero.
The maximum payout is a cap, not a valuation or promise. Trader Lives earn during their mint round and
13 subsequent rounds; expiry ends future allocations, not already-earned claims.

Built by ethboi for continued development toward [NEAR HACKATHON](https://nearhackathon.com/).
Existing code is permitted per the team's clarification. The repository stays private while building;
publication and submission are later human decisions. This is test money on local NEAR, not a production exchange.

## Try the core loop

Verified development toolchain: Node 24.13.0, pnpm 10.18.3, Rust 1.99.1 with
`wasm32-unknown-unknown`, cargo-near 0.22.0. CI uses the same versions. Install dependencies with
`pnpm install --frozen-lockfile`, then `pnpm build:contracts`.

```bash
pnpm demo:judge
# Open http://127.0.0.1:3021
# In another terminal, use the absolute ONEUP_CONFIG printed by the launcher:
ONEUP_CONFIG=/absolute/path/printed/by/launcher/localnet.json pnpm test:judge
```

The judge launcher creates fresh state under `.judge/<timestamp>/`, binds RPC 3130, app 3021,
control 8887 and peer port 25567, runs fixed controllable prices, and starts no bots. It refuses occupied
ports and never resets the ordinary demo. If app port 3021 is occupied, use `ONEUP_JUDGE_APP_PORT=3022 pnpm demo:judge`. Setup/build time is separate from the three-minute walkthrough.
The test deposits for two traders, fills and liquidates positions, waits for NFT settlement, claims test
USDC, sells another NFT, verifies the former owner cannot claim, and verifies the buyer can claim.
Its `e2e.json` records source identity, assertions and nine deployed WASM hashes beside the isolated config.
All pre-existing bootstrap backing is prepared demo state, not external fundraising.
On the Trade screen, **How recovery works** stays available after trading or dismissal. Expand it
for the four-step loop and a next action based on the selected wallet. Open any Life to inspect its
current owner, token ID, originating round, claimable USDC, additional conditional cap and expiry.
Expired Lives with unclaimed USDC remain visible and sellable. Marketplace prices are seller-entered;
no cap discount is presented as expected value. NFT totals span all owners, not personal profit.
See [the recovery journey and retry protocol](docs/RECOVERY_JOURNEY.md) for limits and a walkthrough.

For the animated live-price demo use `pnpm demo` at http://127.0.0.1:3020. It runs twelve bots and
10-minute epochs; state persists in `.localnet/`. It deploys five product contracts and four mocks,
plus unchanged third-party contracts. Rebuilding WASM does not redeploy an existing chain: startup
warns about mismatched hashes or missing build provenance and preserves state. `pnpm verify:deployment` fails on a mismatch.

| Command | Purpose |
|---|---|
| `pnpm verify` | Full gate: all typechecks, Rust/property/SDK/model tests, app/keeper regressions, fresh sandbox tests, sensitivity and production app build |
| `pnpm demo:judge` / `pnpm test:judge` | Isolated controlled demonstration / asserted core-loop check |
| `pnpm verify:deployment` | Compare nine deployed contracts with local WASM; honors `ONEUP_CONFIG` |
| `pnpm demo` | Persistent ordinary demo, live prices and twelve synthetic trading bots |
| `pnpm test` | Rust unit/property, SDK and model tests; excludes sandbox and app/keeper Node tests |
| `pnpm test:ts` / `pnpm test:sandbox` | App/keeper regressions / built-WASM integration tests |
| `pnpm sim` / `pnpm sim:sensitivity` | Historical growth illustration / adverse economic scenarios |
| `pnpm farm` | Historical and same-wallet token farming comparison |
| `pnpm localnet:reset` | Destructively reset the ordinary chain; unnecessary for the isolated judge demo |

`pnpm verify` writes ignored `.verification/` logs and a manifest with the source commit, dirty-state
fingerprint, commands, runtime and log hashes, and fails on source drift. A build manifest binds WASM hashes to Rust/build inputs. Next builds run in a source snapshot so their generated files cannot overwrite the ordinary demo. Use that manifest for current counts; historical reports
retain their original dates and stages. CI artifacts become available only after a future authorized push.

Ordinary demo price steering:
```bash
curl -XPOST localhost:8787/price -H 'content-type: application/json' -d '{"market":"NEAR-USD","movePct":-2}'
```

## Rules and limits

- **Trading:** USDC margin, oracle execution, up to 1000× leverage; max profit 9× margin. No entry or
  funding fee. Winners pay 10–25% of profit; marketplace sellers pay 2%. Liquidation at 90% loss takes
  the full margin. Minimum voluntary hold is 60 seconds.
- **Admission:** maximum wins of both longs and shorts count against pool capacity, including pending
  opens. This reserve invariant prevents over-admission under its accounting assumptions; it does not
  eliminate oracle, owner/operator, vault, implementation or availability risks.
- **Oracle:** a fill needs a price published after placement and within the permitted window. The trusted
  keeper is expected to fill promptly; the contract does not prove it chose the first later price or that
  nobody had advance knowledge. Limit orders can rest up to 24 hours.
- **Recovery:** profitable rounds allocate claim face value and emissions by positive wallet net loss.
  The face is a share of house profit, not necessarily the trader's full loss. Maximum claim is 1.2–2×
  face. Lives share 60% of half the surplus: two thirds to trader Lives and one third to Backer Lives,
  with unused slices passed across. Future profits, caps and expiry limit recovery.
- **Ownership:** Extra Lives and locks are NFTs. Listings require willing USDC buyers; neither immediate
  liquidity nor a sale price is guaranteed. Unclaimed Life proceeds transfer with ownership.
- **Backing:** contributions permanently join the pool. Backer Lives never expire but still depend on
  house profit. The local deployment starts with $250K house seed and $100K synthetic bot backing,
  creating $426K of aggregate Backer Life caps. These are not users or traction.
- **$1UP:** 1B minted once: 900M emissions, 50M spot-liquidity allocation, 42.5M treasury and 7.5M
  reserved for backing incentives. The token constructor initially assigns 50M to treasury; deployment
  moves 7.5M to the house backing allocation. Emissions release with house profit and arrive as locks.
- **Locks:** up to 104 epochs (two years at weekly cadence; accelerated in demos), rewards by amount × time left. Early exit costs up to half the tokens;
  market prices and discounts are assumptions in models, not observed liquidity.
- **Yield/jackpot:** local mock vault and accelerated interest. Cross-chain lending and Chain Signatures
  remain plans. Wind-down distributions in D-29 are also planned, not implemented.

The mechanism combines ideas from Papertrade (loss-linked claims) and Aerodrome (revenue-linked NFT
locks), with capped expiring recovery and reserve admission. These references acknowledge design
lineage, not a claim to have invented every component.

## NEAR and implementation status

Primary positioning: **Unstoppable DeFi**. Secondary: **NFTs That Do Something**. The NFT earns money,
changes claim ownership when transferred and has on-chain dynamic art. DAO ownership and key restrictions
support this story; they do not make this an autonomous business or a proven AI security product.

| Component | Current state |
|---|---|
| House, Extra Life, token, locks, marketplace | Implemented locally; NEP-141/171/178 and NEP-297 events |
| Intents verifier, PoA and solver | Official vendored contracts and signed local execution; bridge credits simulated |
| Ethereum/Solana funding, 1Click | No real bridge deposit or 1Click integration demonstrated; first-use setup can require an additional signature |
| Sputnik DAO | Local ownership and voting; disclosed demo council keys, not independent production governance |
| Function-call keys / NEP-366 | Local sponsored trade calls; a trade-only key can still lose the trading balance |
| MCP / bots | Full-key demo tooling and synthetic activity; no constrained autonomous-agent treasury |
| Oracle | Mock oracle with live, simulated or fixed inputs; Outlayer-compatible call interface, real deployment unverified |
| Buyback swap | Local constant-product mock with custom payload; real Rhea adapter remains to be implemented |
| Vault / Chain Signatures | Mock vault; external lending and Chain Signatures are future work |

## Economic evidence

`pnpm sim` reproduces the historical growth illustration: weekly losses $20K→$2M, assumed mean 15%
house edge, fixed 50% utilisation, $25K seed at a 1× backer claim, 20 random seeds. This is an aggregate-flow
model, not an executable market/admission model. Some synthetic paths exceed available cash; even its
historical headline must not be presented as a solvency or general fairness proof.

`pnpm sim:sensitivity` writes `sim/out/sensitivity.json`: flat/declining activity, low/negative edge,
high utilisation, actual deployment backing and a larger bootstrap. It reports recovery, expired/unpaid
caps, backer repayment, early/late ratios and cash deficits with ranges across seeds. Negative cash flags
infeasible exogenous flows, not a demonstrated contract exploit. High utilisation can leave recovery at
zero; low activity can leave backing substantially unpaid.

The report also compares same-wallet and separate-wallet farming with different assumed lock discounts.
Wallet netting is not Sybil resistance. Extra Life recovery, trade admission, capital timing and real
liquidity can further change profitability. Read assumptions and adverse results before quoting FDVs.

## Repository and evidence

- `contracts/`: five product contracts, four mocks, shared integer maths and fresh-WASM sandbox tests.
- `packages/sdk/`: typed calls and formula vectors. `keeper/`: prices, execution, epoch and retry loops.
- `app/`: Next.js interface. `bots/` and `mcp/`: synthetic demo activity and agent tools.
- `sim/`: floating-point economic illustrations. `contracts/vendor/`: unchanged third-party binaries.
- [Current demo and readiness plan](docs/HACKATHON_READINESS.md), [maths](docs/maths.md),
  [interfaces](docs/interfaces.md), [security limits](docs/SECURITY.md), [historical decisions](docs/decisions.md).

## Licensing

Original OneUp source code and accompanying documentation are **AGPL-3.0-only**; see [LICENSE](LICENSE)
and [NOTICE](NOTICE). Commercial use is permitted under those terms. Covered modified network-served
versions must offer corresponding source to their users. Third-party binaries, dependencies and marks
retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md) and [vendor provenance](contracts/vendor/README.md).
