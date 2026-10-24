// A fresh sibling chain every launch. Never deletes, reconfigures or stops the regular demo.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, copyApp } from "./artifacts.ts";
import { checkPorts, judgePorts, preflight, requireChecks, toolEnv } from "./preflight.ts";
import { OwnedProcesses } from "./owned-processes.ts";
import { localDemoEnv } from "./local-demo-env.ts";

const ports = judgePorts();
// Fail before creating snapshots, running simulations or starting any child.
requireChecks(await preflight({ ports, build: true }));
const [appPort, rpcPort, networkPort, controlPort] = ports.map(p => p.port);
const dir = resolve(ROOT, ".judge", new Date().toISOString().replaceAll(":", "-"));
mkdirSync(dir, { recursive: true, mode: 0o700 });
const env = localDemoEnv({ ...toolEnv, ONEUP_STATE_DIR: resolve(dir, "chain"), ONEUP_CONFIG: resolve(dir, "localnet.json"), ONEUP_RPC_PORT: String(rpcPort), ONEUP_NETWORK_PORT: String(networkPort), EPOCH_LENGTH_S: "45", ONEUP_NEXT_DIST: ".next-judge", ONEUP_SIM_OUTPUT: resolve(dir, "sim/out") });
const appUrl = `http://127.0.0.1:${appPort}`;
writeFileSync(resolve(dir, "judge-profile.json"), JSON.stringify({ appUrl, rpcUrl: `http://127.0.0.1:${rpcPort}`, controlUrl: `http://127.0.0.1:${controlPort}` }));
const processes = new OwnedProcesses(dir, env);
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await processes.close();
  process.exit(code);
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
try {
  const appDir = copyApp(resolve(dir, "app"));
  await processes.success(processes.start("simulation", "pnpm", ["--filter", "@oneup/sim", "start"], ROOT, text => process.stdout.write(text)), 180000);
  requireChecks(await checkPorts(ports));
  console.log(`Isolated judge config: ${env.ONEUP_CONFIG}`);
  let buffer = "";
  const chain = processes.start("chain", "pnpm", ["exec", "tsx", "scripts/localnet.ts"], ROOT, text => { process.stdout.write(text); buffer = (buffer + text).slice(-16000); });
  const deadline = Date.now() + 480000;
  while (!buffer.includes("Ctrl-C")) {
    processes.assertRunning([chain]);
    if (Date.now() > deadline) throw Error("Judge chain deployment exceeded eight minutes; inspect its private chain.log.");
    await new Promise(resolveWait => setTimeout(resolveWait, 200));
  }
  const keeper = processes.start("keeper", "pnpm", ["exec", "tsx", "keeper/src/index.ts", "--prices", "fixed", "--tick", "1000", "--control", String(controlPort)], ROOT, text => process.stdout.write(text));
  const app = processes.start("app", "pnpm", ["exec", "next", "dev", "-H", "127.0.0.1", "-p", String(appPort)], appDir, text => process.stdout.write(text));
  for (const record of [chain, keeper, app]) void record.done.then(code => { if (!stopping) { console.error(`${record.name} exited (${code}).`); void stop(1); } });
  console.log(`Judge app: ${appUrl} (fixed controllable prices; no bots; 45-second epochs).\nRun: ONEUP_CONFIG='${env.ONEUP_CONFIG}' pnpm test:judge\nPrepared state and mocked bridge/oracle/swap/vault must be disclosed.`);
} catch (error) { console.error(error instanceof Error ? error.message : error); await stop(1); }
