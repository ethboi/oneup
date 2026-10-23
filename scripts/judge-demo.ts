// A fresh sibling chain every launch. Never deletes, reconfigures or stops the regular demo.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, copyApp, verifyBuildManifest } from "./artifacts.ts";
const dir = resolve(ROOT, ".judge", new Date().toISOString().replaceAll(":", "-"));
mkdirSync(dir, {recursive: true});
const env = {...process.env, ONEUP_STATE_DIR: resolve(dir, "chain"), ONEUP_CONFIG: resolve(dir, "localnet.json"), ONEUP_RPC_PORT: "3130", ONEUP_NETWORK_PORT: "25567", EPOCH_LENGTH_S: "45", ONEUP_NEXT_DIST: ".next-judge"};
verifyBuildManifest();
const appPort = Number(process.env.ONEUP_JUDGE_APP_PORT ?? 3021);
const appDir = copyApp(resolve(dir,"app"));
// Generate this profile's model data without modifying source SVGs or ordinary demo outputs.
const simulation=spawnSync("pnpm",["--filter","@oneup/sim","start"],{cwd:ROOT,env:{...env,ONEUP_SIM_OUTPUT:resolve(dir,"sim/out")},stdio:"inherit"});
if(simulation.status!==0) throw Error("Judge simulation preparation failed");
writeFileSync(resolve(dir,"judge-profile.json"), JSON.stringify({appUrl:`http://127.0.0.1:${appPort}`}));
const children: ChildProcess[] = [];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const c of children) { try { if (c.pid) process.kill(-c.pid, "SIGINT"); } catch {} } setTimeout(() => process.exit(code), 1500); }
process.on("SIGINT", () => stop()); process.on("SIGTERM", () => stop());
function start(args: string[], cwd = ROOT) {
  const c = spawn("pnpm", args, {cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"]});
  children.push(c); c.stderr!.pipe(process.stderr);
  c.on("exit", code => { if (!stopping) stop(code || 1); });
  return c;
}
// Fail before touching the new chain if any dedicated port is occupied.
const {createServer} = await import("node:net");
for (const port of [3130, 25567, 8887, appPort]) await new Promise<void>((ok, no) => {
  const server = createServer(); server.once("error", no); server.listen(port, "127.0.0.1", () => server.close(e => e ? no(e) : ok()));
});
console.log(`Isolated judge config: ${env.ONEUP_CONFIG}`);
const chain = start(["exec", "tsx", "scripts/localnet.ts"]);
let ready = false, buffer = "";
chain.stdout!.on("data", chunk => {
  process.stdout.write(chunk); buffer += chunk.toString();
  if (!ready && buffer.includes("Ctrl-C")) {
    ready = true;
    start(["exec", "tsx", "keeper/src/index.ts", "--prices", "fixed", "--tick", "1000", "--control", "8887"]).stdout!.pipe(process.stdout);
    start(["exec", "next", "dev", "-H", "127.0.0.1", "-p", String(appPort)], appDir).stdout!.pipe(process.stdout);
    console.log(`Judge app: http://127.0.0.1:${appPort} (fixed controllable prices; no bots; 45-second epochs).\nRun: ONEUP_CONFIG='${env.ONEUP_CONFIG}' pnpm test:judge\nPrepared state and mocked bridge/oracle/swap/vault must be disclosed.`);
  }
});
