# Executable economic experiments

These four cases execute funded orders, oracle updates, settlements, round distributions, claims and withdrawals through the actual OneUp WASM contracts in fresh NEAR sandboxes. They test accounting and bounded behavior. They do **not** establish market demand, sustainable returns or the absence of every farming strategy.

## Run and inspect

From the repository root, with the prerequisites in `README.md`:

```sh
pnpm test:economics
```

This builds all WASMs, verifies their input manifest, runs `contracts/tests/tests/economics.rs` serially, and writes `.verification/economics.json`. A nonzero exit means a build/test failed, a required scenario report is missing, or the source/artifacts changed during the run. After an immediately preceding successful contract build, CI can use `pnpm test:economics --built`; this still refuses stale or altered WASM. A cold build can take substantially longer than a cached run.

The JSON includes source revision and working-change hash, tested WASM hashes, command exit codes and log hashes, observed balances, scenario assertions and limitations. Monetary values are integer strings: USDC has 6 decimals and 1UP has 18. Each run also retains its reports/logs under `.verification/economics-<timestamp>/`. Only the summary JSON is intended for publication: it uses account roles and contains no signing keys or local deployment configuration.

The normal sandbox suite also runs these tests, but only `test:economics` collects the complete report and checks that the source stayed stable. Hashes identify the tested artifacts; the current `non-reproducible-wasm` build does not establish independent bit-for-bit reproducibility.

## What each case proves

| Case | Executed setup | Required observations |
|---|---|---|
| Admission | $100,000 seeded pool; trader deposits $6,000. Attempt $6,000 margin, accept $5,000, attempt an additional $1,000 opposite position. | The two oversized requests fail in actual receipts, preserving balance and liability. The accepted position closes flat, and all $6,000 is withdrawn. A simulation cannot assume these rejected positions were executed. |
| Inactivity and expiry | The seed backer contributes $100,000, a new backer contributes $10,000, and a trader loses $500. Close three rounds, with no new trades after the loss. Use a shortened zero-additional-round earning window to exercise expiry. | The trader claims the original $100 allocation after expiry, but earns nothing further. Later rounds can still distribute previously retained surplus despite zero new house profit. The new backer's $10,000 contribution, $19,160 maximum total payout and actual USDC claim are recorded separately. |
| Adverse house outcome | A trader deposits $1,000 and opens $500 margin, 10× long at $5. Close at $6. | The $1,000 gross profit incurs a $122.50 profit fee; the trader withdraws $1,877.50. House trading cash falls $877.50 below its starting value, and no Life or buyback distribution spends a negative surplus. |
| Two controlled wallets | Two wallets each deposit $1,000. Each opens $500 margin at 10×, one long and one short, both entering at $5 and closing at $5.10. | Both trades pass real admission. The pair has $1,987.75 after trading, claims $2.45 recovery, and withdraws $1,990.20 in total: a $9.80 realized USDC loss. A 245 1UP lock and the unsold Life are reported separately, with no fictitious sale proceeds. |

Every settled checkpoint independently checks:

- The sum of all recorded wallet and contract USDC equals the mock token's total supply.
- House USDC equals its pool, free trading balances, earmarked buyback cash and jackpot cash, with no open orders or positions.
- The Life contract's token balance equals its held-USDC ledger.
- Claim and withdrawal amounts actually arrive in the intended wallets.

No vault capital or yield is used. Buyback allocations remain earmarked USDC rather than being treated as completed token sales.

## Interpretation that matters

**A reserve floor is a distribution rule, not a guarantee against trading losses.** Admitted winning trades can take the pool below its seeded reserve floor. The adverse case checks this explicitly. The contract's unsigned `house_net` distribution field saturates at zero; the report separately records the signed economic loss so zero cannot be mistaken for break-even.

**An inactive round can pay out without generating new revenue.** Earlier retained surplus can fund later distributions. Those payments are not evidence of continuing trading demand or an independent yield source.

**A Backer Life's maximum payout is not principal returned.** Backing adds permanent pool capital and no withdrawable trading balance. The report distinguishes contributed principal, the contractual payout cap, allocated USDC, actual claims and the backer's realized cash position. A large cap does not imply that it will be paid.

**The paired-wallet result is a measured first-round cash result.** It does not assume the remaining NFT or locked token is worthless. They have not been sold, so no realized USDC sale proceeds are counted. Future payouts, rewards, other price paths, governance incentives, other wallets and real secondary-market liquidity could change the result. This experiment is not a general anti-farming proof.

## Remaining economic evidence

Before making a sustainability claim, extend the same contract harness with longer horizons, varied admitted exposures, adverse sequences and several controlled wallets. Track actual cash, rejected orders and remaining obligations at every checkpoint. Keep modeled assumptions separate from observed executions.

These tests use mock USDC, controlled oracle prices and short sandbox rounds. They exclude NEAR gas, account funding and storage costs from the USDC ledger; do not measure oracle latency, real exchange liquidity or dollar-peg risk; and do not provide a return forecast. Buyer/seller interviews and independent pricing choices are separate work. A staged NFT sale establishes transfer behavior, not organic demand.
