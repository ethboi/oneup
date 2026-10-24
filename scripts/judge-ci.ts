// CI owns a new chain, app snapshot and dynamically selected loopback ports for every run.
// Raw config, keys, chain state and process logs stay under ignored .judge/. Upload only .verification/judge-ci/.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { resolve } from "node:path";
import { ROOT, copyApp, sourceIdentity } from "./artifacts.ts";
import { checkPorts, preflight, requireChecks, toolEnv } from "./preflight.ts";
import { OwnedProcesses } from "./owned-processes.ts";
import { localDemoEnv } from "./local-demo-env.ts";

async function availablePorts(count: number): Promise<number[]> {
  const servers: Server[] = [];
  try {
    const ports: number[] = [];
    for (let i = 0; i < count; i++) {
      const server = createServer(); servers.push(server);
      await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
      ports.push((server.address() as { port: number }).port);
    }
    return ports;
  } finally { await Promise.all(servers.map(server => new Promise<void>(done => server.close(() => done())))); }
}
const sdkOnly = process.argv.includes("--sdk-only");
const supportedArgs = new Set(["--sdk-only"]);
for (const arg of process.argv.slice(2)) assert.ok(supportedArgs.has(arg), `Unknown option ${arg}`);
requireChecks(await preflight({ build: true }));
const [appPort, rpcPort, networkPort, controlPort] = await availablePorts(4);
const started = Date.now();
const source = sourceIdentity();
const dir = resolve(ROOT, ".judge", `ci-${Date.now()}-${process.pid}`);
const output = resolve(ROOT, ".verification/judge-ci", `run-${Date.now()}-${process.pid}`);
mkdirSync(dir, { recursive: true, mode: 0o700 });
mkdirSync(output, { recursive: true });
const appUrl = `http://127.0.0.1:${appPort}`;
const env: NodeJS.ProcessEnv = localDemoEnv({ ...toolEnv, ONEUP_STATE_DIR: resolve(dir, "chain"), ONEUP_CONFIG: resolve(dir, "localnet.json"), ONEUP_RPC_PORT: String(rpcPort), ONEUP_NETWORK_PORT: String(networkPort), EPOCH_LENGTH_S: "45", ONEUP_NEXT_DIST: ".next-judge-ci", ONEUP_SIM_OUTPUT: resolve(dir, "sim/out"), ONEUP_PREPARE_BROWSER: "1", ONEUP_BROWSER_FIXTURE: resolve(dir, "browser-fixture.json"), ONEUP_JUDGE_BROWSER_OUTPUT: output, CI: "1" });
writeFileSync(resolve(dir, "judge-profile.json"), JSON.stringify({ appUrl, rpcUrl: `http://127.0.0.1:${rpcPort}`, controlUrl: `http://127.0.0.1:${controlPort}` }));
const processes = new OwnedProcesses(dir, env);
const stages: { name: string; passed: boolean; elapsedSeconds: number }[] = [];
let interrupted = false;
let failure: string | undefined;
const interrupt = () => { interrupted = true; void processes.close(); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
const watchdog = setTimeout(interrupt, 20 * 60 * 1000);
async function stage(name: string, work: () => Promise<void>) {
  if (interrupted) throw Error("Run interrupted or exceeded twenty minutes.");
  console.log(`Judge CI: ${name}`);
  const start = Date.now();
  let passed = false;
  try { await work(); passed = true; }
  finally { stages.push({ name, passed, elapsedSeconds: (Date.now() - start) / 1000 }); }
}
try {
  const appDir = copyApp(resolve(dir, "app"));
  await stage("prepare model data", async () => processes.success(processes.start("simulation", "pnpm", ["--filter", "@oneup/sim", "start"], ROOT), 180000));
  await stage("production app build", async () => processes.success(processes.start("build", "pnpm", ["exec", "next", "build"], appDir), 180000));
  // Builds can take minutes; recheck immediately before binding services rather than trusting the earlier probe.
  requireChecks(await checkPorts([{ name: "app", port: appPort }, { name: "RPC", port: rpcPort }, { name: "network", port: networkPort }, { name: "price control", port: controlPort }]));
  let chainOutput = "";
  const chain = processes.start("chain", "pnpm", ["exec", "tsx", "scripts/localnet.ts"], ROOT, text => { chainOutput = (chainOutput + text).slice(-16000); });
  await stage("fresh isolated deployment", async () => {
    const deadline = Date.now() + 480000;
    while (!chainOutput.includes("Ctrl-C")) {
      processes.assertRunning([chain]);
      if (interrupted || Date.now() > deadline) throw Error("Isolated deployment did not become ready within eight minutes.");
      await new Promise(done => setTimeout(done, 200));
    }
  });
  const keeper = processes.start("keeper", "pnpm", ["exec", "tsx", "keeper/src/index.ts", "--prices", "fixed", "--tick", "1000", "--control", String(controlPort)], ROOT);
  const app = processes.start("app", "pnpm", ["exec", "next", "start", "-H", "127.0.0.1", "-p", String(appPort)], appDir);
  await stage("app readiness", async () => {
    const deadline = Date.now() + 60000;
    while (true) {
      processes.assertRunning([chain, keeper, app]);
      if (interrupted || Date.now() > deadline) throw Error("Isolated app did not become ready within one minute.");
      try {
        const response = await fetch(`${appUrl}/api/config`, { signal: AbortSignal.timeout(3000) });
        if (response.ok) { const config = await response.json(); assert.equal(config.rpcUrl, `http://127.0.0.1:${rpcPort}`); break; }
      } catch {}
      await new Promise(done => setTimeout(done, 250));
    }
  });
  await stage("SDK, chain and keeper journey", async () => {
    await processes.success(processes.start("sdk", "pnpm", ["exec", "tsx", "scripts/judge-e2e.ts"], ROOT), 240000);
    processes.assertRunning([chain, keeper, app]);
    copyFileSync(resolve(dir, "e2e.json"), resolve(output, "sdk.json"));
    copyFileSync(resolve(dir, "browser-fixture.json"), resolve(output, "prepared-fixture.json"));
  });
  if (!sdkOnly) await stage("browser ownership and claim journey", async () => {
    await processes.success(processes.start("browser", "pnpm", ["exec", "playwright", "test", "--config", "scripts/browser/playwright.config.ts"], ROOT), 240000);
    processes.assertRunning([chain, keeper, app]);
    assert.ok(existsSync(resolve(output, "browser.json")), "Browser runner must produce its own result");
    const browser = JSON.parse(readFileSync(resolve(output, "browser.json"), "utf8"));
    assert.equal(browser.status, "passed"); assert.ok(browser.tests.length > 0);
  });
  assert.deepEqual(sourceIdentity(), source, "Source changed during the run; rerun after editing stops.");
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(`Judge CI failed: ${failure} Private diagnostics: ${dir}`);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await processes.close();
  process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
  const finishedSource = sourceIdentity();
  const passed = !failure && !interrupted;
  writeFileSync(resolve(output, "summary.json"), JSON.stringify({ source, finishedSource, checkedAt: new Date().toISOString(), elapsedSeconds: (Date.now() - started) / 1000, passed, scope: sdkOnly ? "SDK/chain/keeper and app API only; browser explicitly not run" : "SDK/chain/keeper plus Chromium browser acceptance", browser: sdkOnly ? "not run (--sdk-only)" : stages.some(s => s.name.startsWith("browser") && s.passed) ? "passed" : "failed or not reached", stages, failure, mocked: ["USDC", "oracle", "swap", "vault", "bridge"], preparedState: "SDK creates a third account's recovery Life before the browser lists, buys and claims it. This proves mechanics, not organic demand." }, null, 2));
  if (!passed) process.exitCode = 1;
  console.log(`Sanitized evidence: ${output}`);
}
