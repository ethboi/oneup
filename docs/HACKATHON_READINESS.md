# Current development and demo plan

This document and executable code supersede the historical staged PLAN.md and obsolete decision notes.
Existing-code eligibility is resolved per the team. Repository publication and submission are deferred.

## Three-minute walkthrough

Build/install/deploy and warm the app before recording. Disclose local test money, prepared bootstrap
backing and any already-settled NFTs. Use `pnpm demo:judge`; follow the printed config with `pnpm test:judge`.

| Time | Demonstration |
|---|---|
| 0:00–0:20 | Target trader and conditional recovery; disclose local chain and test assets |
| 0:20–1:00 | Deposit, delayed fill, controlled price movement and liquidation |
| 1:00–1:45 | Epoch settlement, dynamic Extra Life, actual test-USDC claim |
| 1:45–2:20 | Sell a Life; buyer inherits the unclaimed proceeds and seller loses claim rights |
| 2:20–2:45 | Payout reserve/admission evidence and one asynchronous failure regression |
| 2:45–3:00 | Why NEAR, simulated boundaries and honest economic limitations |

The fixed-price profile removes external price dependencies, not block/receipt timing. Its script asserts
logical outcomes and records elapsed time; this is not a promise that cold setup completes in 180 seconds.
The ordinary live-price/bot demo is separate and remains unchanged in its state and ports.

## Engineering evidence

`pnpm verify` performs all typechecks, unit/property/SDK/model/app/keeper tests, builds the nine WASMs,
runs fresh sandbox integration tests, generates sensitivity results and builds the production app into
a separate source snapshot with its own `.next-verify` and generated Next files. Ignored `.verification/verification.json` identifies source revision, dirty changes and log
hashes; the gate fails if source identity changes during a run. Generated manifests are evidence for the actual working contents, not a claim that uncommitted
changes are already present on remote main. CI is configured locally and requires a future authorized push.

`pnpm verify:deployment` checks all nine first-party/mocked on-chain code blobs against built SHA256s. A build manifest binds these files to Rust/build input hashes and the source identity observed during compilation.
Existing localnet startup warns on mismatch without reset or automatic redeployment. Judge runs create
fresh sibling state. Never use `localnet:reset` to obtain review evidence from a user's active demo.

## Economic interpretation

The historical chart assumes 100× growing loss volume, 15% mean edge, 50% fixed utilisation and a $25K
1× seed claim. Sensitivity uses $250K owner seed plus $60K/$40K contributions ($350K pool, $426K aggregate
backer caps), low/declining activity, negative edge and high utilisation. Synthetic flows can produce cash
deficits because admission and price processes are not modeled. Show those failures with the favorable
cases. Expiry removes future entitlements; it does not ensure equal recovery or economic sustainability.
Farming compares same/separate wallets and assumed discounts; it is not a Sybil-resistance proof.

## Human validation still needed

Recruit five prospective traders independently. Ask them to explain where recovery comes from, what
expires, the winner's cut and why another person would buy a Life. Record actual responses and voluntary
usage; do not substitute bot activity. No recruiting, messaging, deployment or publication is authorized
by this checklist. Real Outlayer/Rhea/bridge integration and a constrained agent wallet are future work.
