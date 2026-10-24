// Executes bounded funded-WASM experiments and writes credential-free, machine-readable evidence.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { ROOT, sha256, sourceIdentity, verifyBuildManifest } from "./artifacts.ts";

const allowedFlags = new Set(["--built"]);
for (const flag of process.argv.slice(2)) if (!allowedFlags.has(flag)) throw Error(`Unknown argument: ${flag}`);
const reuseVerifiedBuild = process.argv.includes("--built");
const source = sourceIdentity();
const startedAt = new Date().toISOString();
const directory = resolve(ROOT, ".verification", `economics-${startedAt.replaceAll(":", "-")}`);
mkdirSync(directory, { recursive: true });
const environment = { ...process.env, PATH: `${homedir()}/.cargo/bin:${process.env.PATH ?? ""}`, ONEUP_ECONOMICS_DIR: directory };
const commands: { command: string; exitCode: number | null; logSha256: string; durationMs: number }[] = [];
let build: ReturnType<typeof verifyBuildManifest> | undefined;
let failure: string | undefined;
const scenarios: unknown[] = [];
const names = ["admission", "inactive-expiry", "adverse-house", "paired-wallets"];
function run(command: string, args: string[], logName: string) {
  const began = Date.now();
  const result = spawnSync(command, args, { cwd: ROOT, env: environment, encoding: "utf8", timeout: 15 * 60_000, maxBuffer: 100 * 1024 * 1024 });
  const log = (result.stdout ?? "") + (result.stderr ?? "") + (result.error ? String(result.error) : "");
  process.stdout.write(log);
  writeFileSync(resolve(directory, logName), log);
  commands.push({ command: [command, ...args].join(" "), exitCode: result.status, logSha256: sha256(log), durationMs: Date.now() - began });
  if (result.status !== 0) throw Error(`${command} failed; inspect ${logName}`);
}
try {
  if (!reuseVerifiedBuild) run("bash", ["contracts/build.sh"], "build.log");
  // --built is only for an immediately preceding build gate; stale or altered WASM is rejected.
  build = verifyBuildManifest();
  run("cargo", ["test", "--manifest-path", "contracts/Cargo.toml", "-p", "oneup-integration", "--test", "economics", "--", "--test-threads=1"], "sandbox.log");
  for (const name of names) {
    const scenario = JSON.parse(readFileSync(resolve(directory, `${name}.json`), "utf8"));
    if (scenario.schema_version !== 1 || scenario.scenario !== name || scenario.passed !== true) throw Error(`Invalid scenario report: ${name}`);
    scenarios.push(scenario);
  }
  // A test run may never certify different contract files from those it started with.
  const finishedBuild = verifyBuildManifest();
  if (JSON.stringify(build.wasms) !== JSON.stringify(finishedBuild.wasms)) throw Error("Contract artifacts changed during economic experiments");
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}
const finishedSource = sourceIdentity();
const sourceStable = JSON.stringify(source) === JSON.stringify(finishedSource);
const report = {
  schema_version: 1,
  kind: "funded-sandbox-economic-experiments",
  source, finishedSource, sourceStable,
  startedAt, finishedAt: new Date().toISOString(),
  passed: !failure && sourceStable && scenarios.length === names.length,
  expected_scenarios: names.length,
  completed_scenarios: scenarios.length,
  contracts_input_sha256: build?.contractsInputSha256,
  wasm_sha256: build?.wasms,
  reused_verified_build: reuseVerifiedBuild,
  commands, scenarios,
  ...(failure ? { failure } : {}),
  limitations: [
    "Four fixed funded scenarios are accounting/regression evidence, not a forecast of sustainability or proof that all farming strategies fail.",
    "Prices and USDC are controlled mocks. No production oracle, live liquidity, real dollar peg, gas profitability or user demand is tested.",
    "A seed backer's contribution is permanently in the pool; allocated payout caps are not capital returned. Only actual USDC claims and withdrawals count as realized cash.",
    "This uses the repository's non-reproducible-wasm build. Hashes identify tested artifacts; they do not prove independent bit-for-bit reproducibility."
  ]
};
writeFileSync(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(resolve(ROOT, ".verification", "economics.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`Economic evidence: .verification/economics.json (${report.passed ? "passed" : "failed"})`);
if (!sourceStable) console.error("Source changed during the run; rerun against a stable checkout.");
process.exitCode = report.passed ? 0 : 1;
