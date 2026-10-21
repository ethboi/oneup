// `pnpm localnet`: a persistent local NEAR chain with OneUp deployed, like `hardhat node` + a deploy script.
// State lives in .localnet/ (`pnpm localnet:reset` wipes it). Contract addresses and dev keys go to
// localnet.json for the keeper, API and app. Ctrl-C stops the node; the next run picks up where it left off.

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deploy } from "./deploy.ts";

const ROOT = resolve(import.meta.dirname, "..");
const HOME = resolve(ROOT, ".localnet");
const CONFIG = resolve(ROOT, "localnet.json");
const BIN = resolve(ROOT, "node_modules/.bin/near-sandbox");
const RPC = "http://127.0.0.1:3030";

function init() {
  console.log("Initialising a new local chain in .localnet/");
  const r = spawnSync(BIN, ["--home", HOME, "init"], { stdio: "ignore" });
  if (r.status !== 0) throw new Error("near-sandbox init failed");
  // Local only: don't listen on every interface.
  const cfgPath = resolve(HOME, "config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.rpc.addr = "127.0.0.1:3030";
  cfg.network.addr = "127.0.0.1:24567";
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

async function waitForRpc(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${RPC}/status`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no RPC at ${RPC} after ${timeoutMs / 1000}s; see .localnet/node.log`);
}

async function deployed(): Promise<boolean> {
  if (!existsSync(CONFIG)) return false;
  const { contracts } = JSON.parse(readFileSync(CONFIG, "utf8"));
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: { request_type: "view_code", finality: "final", account_id: contracts.house },
    }),
  });
  return !(await r.json()).error;
}

/** Keep old blocks (the default keeps five 500-block epochs, about 40 minutes), so the app's history can be
 *  rebuilt from the chain. Set on every start, so chains made before this pick it up too. */
function keepBlocks() {
  const cfgPath = resolve(HOME, "config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  if (cfg.gc_num_epochs_to_keep === 100_000) return;
  cfg.gc_num_epochs_to_keep = 100_000;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

async function main() {
  if (!existsSync(resolve(HOME, "genesis.json"))) init();
  keepBlocks();

  const log = createWriteStream(resolve(HOME, "node.log"), { flags: "a" });
  const node = spawn(BIN, ["--home", HOME, "run"], { stdio: ["ignore", "pipe", "pipe"] });
  node.stdout.pipe(log);
  node.stderr.pipe(log);
  node.on("exit", (code) => {
    console.log(`near-sandbox exited (${code})`);
    process.exit(code ?? 0);
  });
  const stop = () => node.kill("SIGINT");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await waitForRpc();
  console.log(`Local NEAR node up at ${RPC} (logs: .localnet/node.log)`);

  if (!(await deployed())) {
    const epochLengthS = Number(process.env.EPOCH_LENGTH_S ?? 600);
    const d = await deploy({ home: HOME, rpcUrl: RPC, epochLengthS });
    writeFileSync(CONFIG, JSON.stringify(d, null, 2));
    console.log("Wrote localnet.json");
  } else {
    console.log("OneUp already deployed (localnet.json)");
  }

  const d = JSON.parse(readFileSync(CONFIG, "utf8"));
  console.log("\nContracts:");
  for (const [k, v] of Object.entries(d.contracts)) console.log(`  ${k.padEnd(7)} ${v}`);
  console.log(`\nEpochs: ${d.epochLengthS}s · demo trader: ${d.demo.id} · bots: ${d.bots.length}`);
  console.log("Ctrl-C to stop. State persists in .localnet/.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
