# NEAR HACKATHON submission — working draft, not submitted

Existing code is permitted per the team's clarification. The repository is private while building;
publication, public X posting and submission are deferred. Preserve the pre-event baseline and accurately
describe subsequent work. Lead with **NFTs That Do Something** (`nfts`), with **Unstoppable DeFi** (`defi`)
as the related application. This is positioning, not a prediction of track competition or prize odds.

Recheck the [official site](https://nearhackathon.com/) and [submission instructions](https://nearhackathon.com/HACKATHON.md)
before submitting. As checked on 24 October 2026, the deadline is 14 November 2026 at 23:59 UTC.
The site lists Claude Code and Codex among the judges; it does not specify their review order or scoring
weights. A public repository and public X demonstration will be required at submission.

## Description draft

```text
OneUp turns eligible trading losses into transferable recovery rights on NEAR. An Extra Life NFT holds unclaimed USDC and a conditional right to further house-profit payouts. Selling it transfers those rights to the buyer; the former owner cannot claim them.

The prototype combines capped perpetuals with recovery that is conditional, limited and time-bound. Trader Lives earn in their mint round and 13 subsequent rounds. Expiry ends future allocations but preserves earned cash. No entry or funding fee is charged; winners pay 10–25% of profit and marketplace sellers pay 2%. Recovery and resale liquidity are never guaranteed.

The core demonstration follows one Life through inspection, sale with unclaimed USDC and buyer claim. NEAR's token standards and asynchronous receipts make ownership and payout behavior independently testable. A durable issuance queue preserves original entitlements through failed receipts and retries without duplicating rewards or reverting a buyer's ownership.

The repository maps claims to code, regressions and replay commands, with revision-labelled historical evidence. The repeatable demo uses local test money and mock USDC, oracle, swap, vault and bridge boundaries. Native NEAR testnet wallet setup is available; no live deployment is claimed without a recorded transaction journey. Official Intents contracts run locally with simulated bridge credits.

Contract tests and economic experiments address mechanism behavior, not proven demand or sustainability. Five-person research is prepared; no participant results or organic purchases are claimed. OneUp is a prototype, not a production-audited exchange.
```

## Evidence to accompany the final revision

- [Claim and evidence index](evidence/README.md): distinguish historical results from new verification.
- [Prepared demo script](RECOVERY_JOURNEY.md): disclose setup and show one ownership/payout journey.
- [Native wallet setup](NEAR_WALLET_SETUP.md): replace the draft's integration status only after a recorded real-wallet testnet journey.
- [Research protocol](USER_RESEARCH.md) and [results template](USER_RESEARCH_RESULTS.md): report refusals and misunderstanding as well as positive feedback.
- `pnpm verify` and `pnpm test:judge`: retain exact source identity and scope; link CI only after it runs.

## Deferred inputs and publication checklist

- [ ] Lead, email and exact team-size option.
- [ ] Human-selected mainnet NEAR prize account; no address invented by tooling.
- [x] AGPL-3.0-only selected for original code; upstream notices preserved.
- [ ] Final tested revision, sanitized evidence and dependency notices reviewed for publication.
- [ ] Public repository and accurate human-recorded X demo post.
- [ ] Final description checked against the 20–2,000 character limit and actual completed scope.
- [ ] Contact-notice consent and explicit approval of the exact final submission.

No bots, test balances, hypothetical bids or prepared marketplace activity should be described as users,
fundraising or market demand. Session-key method restrictions do not limit losses from allowed trading.
