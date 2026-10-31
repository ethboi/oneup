// A fresh sibling chain every launch. Never deletes, reconfigures or stops the regular demo.
// Unless --empty is given, it then prepares a sample (judge-prepare.ts): an Extra Life for the demo trader and a
// listed one to buy, disclosed in prepared.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fmtUsdc, type Deployment } from "@oneup/sdk";
import { ROOT, copyApp, sourceIdentity } from "./artifacts.ts";
import { prepareJudgeChain } from "./judge-prepare.ts";
import { checkPorts, judgePorts, preflight, requireChecks, toolEnv } from "./preflight.ts";
import { OwnedProcesses } from "./owned-processes.ts";
import { localDemoEnv } from "./local-demo-env.ts";

for (const arg of process.argv.slice(2)) if (arg !== "--empty") throw Error(`Unknown option ${arg}; the only one is --empty (skip the prepared sample)`);
const empty = process.argv.includes("--empty");
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
  console.log(`\nJudge app: ${appUrl} (fixed controllable prices; no bots; 45-second rounds). The bridge, oracle, swap and vault are mocks.`);
  if (!empty) {
    console.log("Preparing a sample, about a minute:");
    try {
      const d: Deployment = JSON.parse(readFileSync(env.ONEUP_CONFIG!, "utf8"));
      const p = await prepareJudgeChain(d, `http://127.0.0.1:${controlPort}`, line => console.log(line));
      // public fields only: the config holds local throwaway keys
      writeFileSync(resolve(dir, "prepared.json"), JSON.stringify({
        source: sourceIdentity(), appUrl, demoLife: p.demoLife, listing: p.listing,
        preparedState: "Scripted: the demo trader and bot3 were liquidated by a controlled 2% price drop; bot3 claimed its Extra Life's USDC and listed the Life for a fifth of its remaining payout limit. The price is set by this script and says nothing about demand.",
      }, null, 2));
      console.log(`Ready. The demo trader owns Extra Life ${p.demoLife.token_id} with $${fmtUsdc(BigInt(p.demoLife.claimable))} to claim (Extra Lives tab),\nand ${p.listing.seller}, having claimed its USDC, lists Extra Life ${p.listing.tokenId} for $${fmtUsdc(BigInt(p.listing.priceAtomic))}: up to $${fmtUsdc(BigInt(p.listing.remainingLimitAtomic))} of future payouts (Market tab).\nPrepared state: ${resolve(dir, "prepared.json")}`);
    } catch (error) { console.error(`The sample wasn't prepared (${error instanceof Error ? error.message : error}). The app runs on the empty chain.`); }
  }
  console.log(`\nEnd-to-end check: ONEUP_CONFIG='${env.ONEUP_CONFIG}' pnpm test:judge\nAI agents: ONEUP_CONFIG='${env.ONEUP_CONFIG}' pnpm mcp (an MCP server on stdio). Without ONEUP_CONFIG it uses the newest judge chain when there's no regular demo, so Claude Code in this folder (.mcp.json) finds it. Actions show on the Agents tab.\nCtrl-C stops everything.`);
} catch (error) { console.error(error instanceof Error ? error.message : error); await stop(1); }
