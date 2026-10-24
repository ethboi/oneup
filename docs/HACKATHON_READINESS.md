# Current development and demo plan

This document and executable code supersede the archived `PLAN.md` and historical decision notes.
Existing-code eligibility is resolved per the team. Repository publication and submission are deferred.
Lead with transferable recovery rights and the behavior of the Extra Life NFT. Native NEAR wallet setup
is [documented separately](NEAR_WALLET_SETUP.md); a public testnet deployment must be verified before
calling that integration live.

## Three-minute prepared walkthrough

Install, build, deploy and warm the app before recording. Use `pnpm demo:judge`; follow its printed config
with `pnpm test:judge` for the separate SDK check. Prepare a settled trader Life with claimable test USDC
and a second funded identity. Disclose local test money, seed/backer balances, mock boundaries and prepared
settlement at the beginning. Do not imply this short recording creates the loss from a fresh chain.

| Time | Demonstration |
|---|---|
| 0:00–0:35 | Describe the trader and show the prepared eligible loss, Life and originating round |
| 0:35–1:15 | Explain owner, available USDC, remaining payout limit and expiry; leave the cash attached to the Life |
| 1:15–2:20 | List that same Life with unclaimed funds, switch to the buyer, inspect the asking price, purchase and claim as new owner |
| 2:20–3:00 | Return to former owner; show unavailable owner actions, then the separately recorded contract rejection; disclose economic and integration limits |

The [recovery journey](RECOVERY_JOURNEY.md) is the detailed script. The prior prepared browser rehearsal
took 140.993 seconds. The full trade/liquidation-to-sale path took 253.506 seconds and used one CLI price
change. [The historical record](evidence/historical-browser.json) identifies revisions and limitations.
Neither is a cold-start benchmark or a human usability study. A sale between prepared test identities
is mechanism evidence; independent bids and demand require [research](USER_RESEARCH.md).

## Engineering evidence

Use the [evidence index](evidence/README.md) for claim → code → regression → command → scope. `pnpm verify`
runs typechecks, unit/property/SDK/model/app/keeper tests, fresh-WASM sandbox checks, sensitivity and a
production build in a separate source snapshot. Its ignored `.verification/verification.json` binds
stage exits and log hashes to the source revision and dirty fingerprint; source drift fails the gate.
Do not quote old test counts as new evidence or claim a CI run before it exists.

`pnpm verify:deployment` compares nine deployed local code blobs against built SHA-256s. This establishes
binary identity, not independent build reproducibility. Existing localnet startup warns on mismatches
without resetting state. Use the isolated launcher rather than resetting an active user's chain.

Native wallet connection requires separately configured testnet contracts and a human-controlled account.
A unit-tested signer adapter and successful local browser demo do not establish a signed testnet journey.
Record the network, account, transaction outcomes and limitations after that journey is actually run.
The local session-key acceptance sequence—trade succeeds, withdrawal is denied, then revocation blocks
further use—remains a follow-up. Helper tests do not establish that complete on-chain sequence, and the
native testnet profile requests no session key.

## Economic and product evidence

The historical model assumes 100× growing loss volume, 15% mean edge, fixed utilization and a $25K seed.
Its sensitivity variants include deployment backing, low activity, adverse edge and high utilization.
Some exogenous paths exceed available cash because they do not execute contract admission. Those paths
are infeasible model inputs, not proof of a contract exploit. Compare feasible contract experiments with
these illustrations; separate realized cash from unsold NFT/token marks and cap payment from principal return.

Use [five independent participant sessions](USER_RESEARCH.md) to test comprehension, seller alternatives,
buyer evidence requirements and hypothetical bid/ask overlap. [Results](USER_RESEARCH_RESULTS.md) remain
blank until sessions occur. Do not count bots, prepared backing or scripted sales as customers or traction.
Real external oracle/swap/vault/bridge deployments remain separate integration work.

## Review and publication

The [official site](https://nearhackathon.com/) confirms AI judges but does not state that they review first
or publish a current scoring formula. Prepare searchable evidence and a consistent repository rather than
assuming hidden judge prompts. Follow the [submission draft](SUBMISSION.md) and recheck official instructions
before publication. The pre-event commit history must remain distinguishable from work done during the event.
