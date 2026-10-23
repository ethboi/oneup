# NEAR HACKATHON submission — working draft, not submitted

Existing code is permitted per the team's clarification. We are still building and keeping the repository
private. Publication, X posting and submission are deferred. Preserve the pre-event baseline and describe
subsequent work accurately; do not retrospectively claim all existing work was built during the event.

Primary track: Unstoppable DeFi (`defi`). Secondary: NFTs That Do Something (`nfts`).
See the [official site](https://nearhackathon.com/) and [current instructions](https://nearhackathon.com/HACKATHON.md)
again before submission. The current deadline is 14 November 2026, 23:59 UTC; one submission, not editable.

## Description draft

```text
OneUp is a perps prototype on NEAR where eligible trading losses become tradable recovery NFTs. Trade, receive an Extra Life after a profitable round, claim USDC from future house profit, or transfer the NFT and its unclaimed USDC to a buyer.

Each trade reserves its capped maximum payout against a shared USDC house pool. There is no entry or funding fee; winners pay a 10–25% profit cut. Recovery is conditional, capped and time-limited: trader Lives earn in their mint round and 13 subsequent rounds. Listing an NFT requires a willing buyer. These are claims on future profits, not guaranteed refunds.

NEAR provides asynchronous contract composition, token and NFT standards, restricted trading keys and sponsored calls. The local prototype runs the official Intents verifier with a custom solver and simulated bridge credits, plus Sputnik DAO ownership and dynamic on-chain NFT art. USDC, oracle, swap and vault boundaries are mocks. Outlayer, Rhea and cross-chain lending are intended integrations, not demonstrated deployments.

The repository includes contract/property/sandbox tests, failure-recovery regressions, a deterministic-price isolated demo and economic sensitivity reports, including unfavorable regimes. It runs on local NEAR with test money and has not been production-audited.
```

## Deferred human inputs and publication checklist

- [ ] Lead, email and exact team-size option.
- [ ] Human-selected mainnet NEAR prize account; no address invented by tooling.
- [x] AGPL-3.0-only selected for original code; upstream notices preserved. Dependency obligations still need review before external distribution.
- [ ] Authorized publication of the final tested repository revision.
- [ ] Human-recorded and published public X demo post, accurately describing event work.
- [ ] Final description checked against the 20–2,000 character limit.
- [ ] Contact-notice consent and explicit approval of the exact final submission.

## Claims and proof

Use `pnpm verify` for current test evidence and `pnpm test:judge` for source-bound local core-loop evidence.
Public CI results do not exist until a future push executes the workflow. No bots, seed funds or synthetic
marketplace activity should be described as external users, fundraising or demand.
