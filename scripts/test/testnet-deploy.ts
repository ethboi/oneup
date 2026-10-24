import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { assertFreshTestnetAccount, assertTestnetTransaction, executeTestnet, parseTestnetMode, publicTestnetProfile, testnetPlan } from "../deploy-testnet.ts";

const plan = () => testnetPlan({ account: "operator-example.testnet" });
test("testnet plan is bounded and includes only nine core contracts and one keeper", () => {
  const p = plan();
  assert.equal(p.accounts.length, 10);
  assert.equal(Object.keys(p.contracts).length, 9);
  assert.equal(p.allocatedTestNear, 37);
  assert.equal(p.minimumAvailableTestNear, 40);
  assert.ok(p.accounts.every(a => a.accountId.endsWith(".operator-example.testnet") && a.accountId.length <= 64));
  assert.deepEqual(p.excluded, ["Intents", "bridge", "solver", "DAO", "bots", "mainnet"]);
  assert.equal(p.mockVaultAprPpm, "0");
});
test("testnet plan rejects mainnet, invalid/oversized names, unapproved RPC and invalid cadence", () => {
  for (const account of [undefined, "alice.near", "Alice.testnet", "a..testnet", "a-.testnet", "a_b_.testnet", `${"a".repeat(50)}.testnet`]) assert.throws(() => testnetPlan({ account }), /testnet account/);
  for (const rpcUrl of ["http://rpc.testnet.near.org", "https://rpc.mainnet.near.org", "https://rpc.testnet.near.org.evil.invalid", "https://rpc.testnet.near.org/path", "https://user:pass@rpc.testnet.near.org"]) assert.throws(() => testnetPlan({ account: "alice.testnet", rpcUrl }), /RPC must/);
  for (const epochLengthS of ["0", "59", "604801", "1.5", "NaN", "Infinity"]) assert.throws(() => testnetPlan({ account: "alice.testnet", epochLengthS }), /integer/);
});
test("public profile is constructed without account credentials or simulated external integrations", () => {
  const profile = publicTestnetProfile(plan());
  assert.deepEqual(Object.keys(profile).sort(), ["network", "rpcUrl", "epochLengthS", "contracts", "markets", "testUsdcFaucet"].sort());
  assert.equal(profile.network, "testnet");
  assert.equal(profile.testUsdcFaucet, true);
  assert.ok(!JSON.stringify(profile).includes("key"));
  assert.ok(!("intents" in profile));
  assert.ok(!("dao" in profile.contracts));
});
test("execute is explicit and mutually exclusive with plan", () => {
  assert.equal(parseTestnetMode([]), "plan");
  assert.equal(parseTestnetMode(["--plan"]), "plan");
  assert.equal(parseTestnetMode(["--execute"]), "execute");
  assert.throws(() => parseTestnetMode(["--plan", "--execute"]));
  assert.throws(() => parseTestnetMode(["--execut"]));
});
test("default CLI plan ignores credentials and creates no deployment directory", () => {
  const account = `plan-${process.pid}.testnet`;
  const expected = testnetPlan({ account });
  assert.equal(existsSync(expected.outputDirectory), false);
  const result = spawnSync(process.execPath, ["--import", "tsx", resolve(import.meta.dirname, "../deploy-testnet.ts")], { encoding: "utf8", env: { ...process.env, ONEUP_TESTNET_ACCOUNT: account, ONEUP_TESTNET_CREDENTIALS: "/missing/never-read.json", ONEUP_TESTNET_RPC: expected.rpcUrl, ONEUP_TESTNET_EPOCH_SECONDS: "600" } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).effects, "No RPC, credentials, filesystem writes or transactions");
  assert.equal(existsSync(expected.outputDirectory), false);
});
test("fresh-account preflight fails closed on existing accounts or ambiguous RPC failures", () => {
  assert.doesNotThrow(() => assertFreshTestnetAccount("house.example.testnet", { error: { cause: { name: "UNKNOWN_ACCOUNT" } } }));
  for (const reply of [{ result: { amount: "0" } }, { error: { cause: { name: "TIMEOUT_ERROR" } } }, {}, { result: {}, error: { cause: { name: "UNKNOWN_ACCOUNT" } } }]) assert.throws(() => assertFreshTestnetAccount("house.example.testnet", reply));
});
test("an apparently successful transaction with a failed receipt is not marked complete", () => {
  assert.equal(assertTestnetTransaction({ status: { SuccessValue: "" }, transaction: { hash: "example" }, receipts_outcome: [] }), "example");
  assert.throws(() => assertTestnetTransaction({ status: { Failure: {} } }));
  assert.throws(() => assertTestnetTransaction({ status: { SuccessValue: "" }, receipts_outcome: [{ outcome: { status: { Failure: {} } } }] }));
});
test("a mutated deployment budget is rejected before credentials or networking", async () => {
  const p = plan(); p.minimumAvailableTestNear = 1;
  await assert.rejects(executeTestnet(p, "/missing/never-read.json"), /fixed reviewed/);
});
