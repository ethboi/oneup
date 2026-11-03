# Native NEAR wallet setup

The app has two separate modes. The existing **local demo** uses disposable built-in accounts and needs
no external wallet. The **testnet profile** uses NEAR Connect (`@hot-labs/near-connect` 0.11.4),
with **Meteor Wallet recommended** and a picker for testnet-compatible alternatives. A tester connects
their own named NEAR testnet account. MyNearWallet is excluded; Rabby and Phantom signing are not integrated.

[MyNearWallet announces deprecation on 31 October 2026](https://www.mynearwallet.com/sunset), so it is
unsuitable as the entry's default wallet. The [official NEAR Wallet Selector repository](https://github.com/near/wallet-selector)
recommends the connector transition. [Meteor's integration guide](https://github.com/Meteor-Wallet/meteor-public)
and the [connector manifest](https://github.com/azbang/near-connect/blob/main/repository/manifest.json)
identify testnet support. NEAR Connect, also referred to as HOT Connect, is the connector; **HOT Wallet
is a separate wallet and is not the recommended testnet signer**. These references were checked on
24 October 2026 and should be rechecked before the final demonstration.

**Current status:** the wallet adapter, configuration boundaries and offline deployment planning are
implemented. No operator account was supplied, no testnet deployment was executed, and no real-wallet
testnet transaction journey has been verified. Local browser tests and mocked signer tests do not fill
that gap. This guide prepares those next steps without creating an account or spending funds.

## What is deployed

The preparation script creates nine fresh contract subaccounts plus one keeper below a funded operator:
house, Extra Life, token, locks, marketplace, mock USDC, mock oracle, mock swap and mock vault. The operator
retains contract administration and runs buybacks; the keeper executes trades and pushes prices. There is
no DAO, bridge, Intents verifier, solver or bot deployment in this profile. Those local-demo integrations
must not be represented as public testnet integrations.

Only test assets are used. Setup mints 250,000 test USDC as prepared house seed and 100,000 as mock swap
liquidity. Neither is external funding. The test USDC faucet permits up to 10,000 per call and is not scarce
collateral. The mock vault has **zero APR** in this profile; it proves deposit/recall behavior, not yield.

Contract accounts receive 35 test NEAR in total and the keeper receives 5: **40 test NEAR allocated**.
The script requires another 3 available test NEAR on the operator for transaction/storage headroom,
**43 available after the operator's existing storage requirement**. These fixed amounts are a preparation
budget, not a price quote or an unlimited operating allowance. Keeper gas requires later monitoring.
Successful setup deletes the nine deployment keys, so this script offers no upgrade or automatic refund
path for their balances. Never use a mainnet account or real USDC with this prototype.

## 1. Prepare an operator and separate tester

Use the [official NEAR CLI account guide](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md)
to create/fund a named `.testnet` operator account and retain its full-access credential in a local file.
Use a dedicated development operator, not a mainnet account or your personal production key. Faucet
availability and allocations can change; check the actual available test balance against the plan.

For browser testing, use [Meteor's official setup guide](https://docs.meteorwallet.app/) to create
or import a separate participant account, selecting **testnet** in the wallet. Use the web wallet or
extension linked from that guide. Verify the chosen account exists on testnet before connecting it to
OneUp; a mainnet account is not interchangeable with a testnet account. The app's picker offers only
compatible testnet choices and excludes MyNearWallet. The operator is an administrator and must not
stand in for an independent participant.
Keep its credential out of chat, screenshots, shell arguments and the repository. The script accepts a
standard JSON file containing `account_id` and either `private_key` or `secret_key`; the account must match
`ONEUP_TESTNET_ACCOUNT`, and the file must belong to the current user with permissions `0600` or tighter.
It never accepts a seed phrase and does not search your filesystem for credentials.

## 2. Review the offline plan

Install the toolchain and dependencies from [README](../README.md). Replace `YOUR_OPERATOR` with your
chosen account label; it is a placeholder, not an existing deployment.

```bash
ONEUP_TESTNET_ACCOUNT=YOUR_OPERATOR.testnet pnpm deploy:testnet --plan
```

Omitting `--plan` also produces a plan. This command does **not** contact RPC, read credentials, generate
keys, create files or submit transactions. It prints the derived account IDs, fixed budget, mocks and
output directory. All child IDs must fit 64 characters, so the operator ID is limited to 57.

Optional environment settings: `ONEUP_TESTNET_EPOCH_SECONDS` (60–604800, default 600) and
`ONEUP_TESTNET_RPC` (exactly `https://rpc.testnet.near.org` or `https://test.rpc.fastnear.com`). Arbitrary
endpoints, mainnet, credentials in URLs and custom URL paths are rejected.

## 3. Execute later, after the plan is approved

This step sends testnet transactions. It has **not** been run as part of preparing these instructions.
Build current WASM first; deployment verifies the build manifest and storage budget before mutation.

```bash
pnpm build:contracts
ONEUP_TESTNET_ACCOUNT=YOUR_OPERATOR.testnet \
ONEUP_TESTNET_CREDENTIALS=/absolute/private/path/operator.json \
pnpm deploy:testnet --execute
```

The script checks the RPC network, full-access operator key, available balance and absence of every target
account. It refuses an existing output directory or any existing child account rather than upgrading it.
Deployment and initialization occur in one transaction per contract, avoiding a public initialization
window. Setup wires and seeds the contracts, verifies deployed hashes, then removes deployment keys.

It writes only under ignored `.testnet/<operator-account>/`, with directory mode `0700` and files `0600`:

- `operator.json`: **private** owner/keeper credentials for the keeper. The legacy `demo` field repeats
  the operator identity for type compatibility; it is never a public demo account.
- `recovery-keys.json`: **private** generated child keys persisted before transactions. Contract keys
  are deleted on chain after success; keeper access remains sensitive.
- `plan.json` and `progress.json`: planned allocations, source/build identity, completed steps and hashes.
- `public.json`: an explicitly constructed **keyless** app profile: network, RPC, round length, contracts,
  markets and test-faucet capability. It contains no owner, keeper, demo, bots or Intents credentials.

If setup stops, some transactions may have completed. Preserve the entire private directory. Inspect
`pendingStep` and transaction hashes against testnet before deciding how to recover; the script deliberately
has no automatic resume, account deletion or redeployment. An uncertain transaction is not safe to repeat
blindly. Do not delete the output folder to bypass its guard. A fresh attempt needs a separately reviewed
unused account namespace; partial accounts may retain funded balances.

## 4. Run the keeper and a separate app instance

After successful setup, set paths to the actual absolute files. Do not pass the private operator config
to the web app. Keep the ordinary local demo on its existing port.

```bash
ONEUP_CONFIG=/absolute/repo/.testnet/YOUR_OPERATOR.testnet/operator.json \
ONEUP_STATE_DIR=/absolute/repo/.testnet/YOUR_OPERATOR.testnet \
pnpm keeper --prices fixed --control 8888 --tick 3000 --price-tick 3000
```

Fixed inputs make this a controlled mock-oracle demonstration; prices expire if the keeper stops. The
control endpoint binds loopback only. Port 8888 must be free; select another unused control port if needed.
The keeper retains privileged administration/price-pushing authority and consumes test NEAR while running.
Stop it when the session ends.

In a separate terminal, use an unused app port:

```bash
ONEUP_PUBLIC_CONFIG=/absolute/repo/.testnet/YOUR_OPERATOR.testnet/public.json \
ONEUP_NEXT_DIST=.next-testnet \
pnpm --filter @oneup/app exec next dev --hostname 127.0.0.1 --port 3023
```

Open `http://127.0.0.1:3023`. Testnet mode reads contracts directly and requests transaction approval from
the connected wallet. It does not use local demo keys, sponsored relay, simulated bridge or the local
activity indexer. Historical views that depend on that indexer are unavailable. Session-key UI is local
only: the NEAR Connect flow requests account-only connection without adding an access key, and
each transaction is sent to the selected wallet for approval. Reconnect after a full page reload. OneUp uses the account returned by explicit sign-in rather than silently choosing from remembered accounts.
Disconnecting changes the selected account;
it is not a claim that a new restricted key was revoked. A wallet advertising testnet compatibility does
not replace the actual acceptance run below.

## 5. Record an actual wallet acceptance run

Use two independent testnet participant accounts after deployment. Record the source revision, network,
contract addresses, outcomes and transaction hashes; never record secrets or signed credentials.

1. Choose Meteor (or a compatible alternative), connect account A and verify both its identity and testnet network. Reject a transaction and verify that the app does not show success.
2. Approve a test-USDC faucet request, deposit and an admissible trade. Verify balances and order receipt.
3. Let the keeper execute a controlled loss, settle the round and create the eligible Life. Explain the
   prepared seed, mock price movement, fees, cap and conditional recovery.
4. List a Life with unclaimed funds and inspect it as account B. Buy it, verify ownership and claim as B. As A, verify owner actions disappear; separately verify a former-owner contract claim fails.
5. Test an expired Life with unclaimed funds, wallet disconnect/reconnect, account change before approval
   and an RPC failure. Report pending/failed transactions accurately and refresh balances before retrying.

A successful run establishes a native-wallet testnet journey. It does not establish production security,
independent oracle quality, sustainable recovery or buyer demand. Keep the repeatable local journey as a
separate regression fixture and run the [user research protocol](USER_RESEARCH.md) for product questions.
