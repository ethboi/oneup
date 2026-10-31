# Evidence index

This directory keeps a small, credential-free historical record in the repository. These results are
**not verification of the current checkout**. Rerun the commands below for the source you are reviewing.
No deployment config, private key, seed phrase or account credential is included. Local account IDs are
public identifiers for disposable test accounts. Never copy `localnet.json` or a whole `.judge/` folder here.

| Claim | Implementation and regression | Run and observe | Scope |
|---|---|---|---|
| A sale transfers payout rights | [Life contract](../../contracts/extra-life/src/lib.rs), [market test](../../contracts/tests/tests/market.rs), [judge journey](../../scripts/judge-e2e.ts) | Start `pnpm demo:judge`, then `ONEUP_CONFIG=<printed-config> pnpm test:judge`; ownership changes, former-owner claim fails, buyer claims | SDK, local chain, keeper and config API; not a browser test |
| Failed issuance preserves the original entitlement | [Recovery queue](../../contracts/house/src/recovery.rs), [failure/retry regression](../../contracts/tests/tests/recovery.rs) | `pnpm test:sandbox`; receiver failure and lost confirmation retry without duplicate issuance or reverting NFT ownership | Fresh compiled WASM and local sandbox receipts |
| Expiry preserves allocated USDC | [Life regression](../../contracts/extra-life/src/tests.rs), [epoch test](../../contracts/tests/tests/epoch.rs), [presentation regression](../../app/test/life-economics.ts) | `pnpm test`, `pnpm test:sandbox`, `pnpm test:ts`; expired future limit is zero while allocated cash remains claimable | Contract behavior and UI data helper; not an expected return |
| Admission reserves capped payout liability | [House invariants](../../contracts/house/src/tests.rs), [judge journey](../../scripts/judge-e2e.ts) | `pnpm test` and `pnpm test:judge`; excess liability is rejected | Model assumptions exclude dishonest oracle/owner and unavailable external services |
| Machine clients distinguish cash from conditional rights | [MCP presentation](../../mcp/src/life-summary.ts), [regressions](../../mcp/src/life-summary.test.ts) | `pnpm --filter @oneup/mcp test`; transferred, expired, fully allocated and pending-settlement Lives stay distinct | Numeric display plus exact integer USDC fields; no profitability claim |
| Funded economic cases reconcile actual cash | [Contract experiments](../../contracts/tests/tests/economics.rs), [report runner](../../scripts/economic-report.ts), [scope](../ECONOMIC_EXPERIMENTS.md) | `pnpm test:economics`; inspect `.verification/economics.json` for admission, inactivity/expiry, adverse house outcomes and paired-wallet accounting | Controlled sandbox cases; not demand, sustainable returns or a general anti-farming proof |
| Browser actions transfer one Life and its cash | [Browser acceptance](../../scripts/browser/recovery.spec.ts), [isolated runner](../../scripts/judge-ci.ts) | `pnpm test:judge:ci`; seller lists an unclaimed Life, buyer purchases and claims, former-owner controls disappear | Newly authored browser check; not executed locally yet. SDK separately asserts former-owner rejection |

See [the recovery journey](../RECOVERY_JOURNEY.md) for the prepared browser script and
[research protocol](../USER_RESEARCH.md) for the product-demand experiment. A test-USDC trade proves a
mechanism; it does not establish a market price, customer demand or live integration.

## Retained results

| Artifact | Revision and scope |
|---|---|
| [Verification manifest](recovery-verification.json) | Clean `b188d542d223163d87d16cd2f01099596b882cbf`; 2026-10-23, eight stages exited successfully. The artifact does not contain an aggregate test count; do not infer one. Original full logs are not included. |
| [SDK journey](recovery-e2e.json) | Same clean revision; ten named assertions, 101.808 seconds, nine deployed/local WASM hash matches. Includes build inputs and individual hashes. |
| [Browser record](historical-browser.json) | Full and prepared journeys at `da6918b7c5605b296f1c9bb469908d0c4bf627aa`; later presentation smoke at `b188d54`. Full path 253.506 seconds; prepared path 140.993 seconds. |
| [Former-owner contract rejection](recovery-former-owner-rejection.json) | Separate SDK call for the full browser journey's token; browser only demonstrated hidden owner actions. |
| [File hashes](manifest.json) | SHA-256 hashes of retained records and screenshots; records which data was curated from the larger original browser artifact. |

The short walkthrough excluded installation, deployment, funding, liquidation and settlement preparation.
The full browser flow used one CLI price-control action. Timings include agent interaction and inspection;
they are not human usability measurements. These observations predate the current wallet branch.
Hash equality shows which binaries ran; it is not proof of independently reproducible builds.

Selected historical screenshots: [Life](recovery-browser-life.png), [buyer](recovery-browser-buyer.png),
[former owner](recovery-browser-former-owner.png), [expired with cash](recovery-expired-life.png).
They depict prepared local accounts and test funds, not users, real yield or organic purchases.

## Recording a new result

After installing dependencies, use `pnpm preflight --compile` for build prerequisites. After building
contracts, `pnpm preflight --judge` checks the WASM manifest and isolated-demo ports. Install Chromium with
`pnpm exec playwright install --with-deps chromium` before `pnpm test:judge:ci`; its ignored
`.verification/judge-ci/<run>/` contains separate SDK/browser reports and a source-bound summary.
`--sdk-only` explicitly skips the browser and must not be reported as browser acceptance.

1. Stop source edits and record `git rev-parse HEAD` plus `git status --short` before testing.
2. Run `pnpm verify`. Its ignored `.verification/verification.json` binds stage exits and log hashes to
   the revision and dirty-state fingerprint and fails if source changes during the run.
3. Run the isolated judge journey and retain its `e2e.json`. Record UI actions separately from SDK calls.
4. Curate only the manifest, outcome report and selected screenshots. Inspect every field for credentials
   and private paths; never include account/config files. Identify mocks, prepared state and failures.
5. Label current evidence with its exact source identity. Keep historical reports unchanged, and replace
   no historical result with a more favorable claim. CI links count as evidence only after a run exists.
