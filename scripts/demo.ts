// `pnpm demo`: everything in one command. Builds the contracts if needed, runs the simulation if it has no
// results yet, starts the local chain (deploying on first run), then the keeper, the bots and the app.
// Ctrl-C stops it all; chain state persists in .localnet/ (`pnpm localnet:reset` for a fresh start).
// `pnpm demo --lan` also serves the app to your local network, to try it on a phone. That page hands out
// the localnet's throwaway dev keys, so only use it on a network you trust.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const WASMS = ["oneup_house", "oneup_extra_life", "oneup_token", "oneup_ve", "oneup_market", "mock_usdc", "mock_oracle", "mock_swap", "mock_vault"];
const APP_URL = "http://127.0.0.1:3020";
const LAN = process.argv.includes("--lan");
const LAN_URLS = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => `http://${i!.address}:3020`);
const children: ChildProcess[] = [];

const COLORS = { chain: 90, keeper: 36, bots: 35, app: 33 } as const;
type Name = keyof typeof COLORS;

function start(name: Name, cmd: string, args: string[], onLine?: (line: string) => void, env: Record<string, string> = {}): ChildProcess {
  const c = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "0", ...env } });
  const tag = `\x1b[${COLORS[name]}m${name.padEnd(6)}\x1b[0m│ `;
  let buf = "";
  const out = (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const l of lines) {
      if (l.trim()) process.stdout.write(tag + l + "\n");
      onLine?.(l);
    }
  };
  c.stdout!.on("data", out);
  c.stderr!.on("data", out);
  c.on("exit", (code) => {
    process.stdout.write(`${tag}exited (${code})\n`);
    if (!stopping) stop(1);
  });
  children.push(c);
  return c;
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children.reverse()) c.kill("SIGINT");
  setTimeout(() => process.exit(code), 1500);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

function step(msg: string, cmd: string, args: string[], cwd = ROOT) {
  console.log(`\n▸ ${msg}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`✕ ${msg} failed`);
    process.exit(1);
  }
}

/** The newest change to any contract's Rust source, so an edited contract is rebuilt before it's deployed. */
function newestSource(dir = resolve(ROOT, "contracts")): number {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "target" || e.name === "vendor" || e.name.startsWith(".")) continue;
    const p = resolve(dir, e.name);
    if (e.isDirectory()) t = Math.max(t, newestSource(p));
    else if (e.name.endsWith(".rs") || e.name === "Cargo.toml") t = Math.max(t, statSync(p).mtimeMs);
  }
  return t;
}
const wasm = (w: string) => resolve(ROOT, `contracts/target/near/${w}/${w}.wasm`);
const src = newestSource();
if (WASMS.some((w) => !existsSync(wasm(w)) || statSync(wasm(w)).mtimeMs < src)) {
  step("Building contracts (needs Rust + cargo-near; see README)", "./build.sh", [], resolve(ROOT, "contracts"));
}
if (!existsSync(resolve(ROOT, "sim/out/results.json"))) {
  step("Running the early-vs-late simulation", "pnpm", ["--filter", "@oneup/sim", "start"]);
}

console.log("\n▸ Starting the local NEAR chain");
start("chain", "pnpm", ["-s", "localnet"], (line) => {
  if (!line.startsWith("Ctrl-C")) return;
  start("keeper", "pnpm", ["-s", "--filter", "@oneup/keeper", "start"]);
  setTimeout(() => start("bots", "pnpm", ["-s", "--filter", "@oneup/bots", "start"]), 3000);
  start("app", "pnpm", ["-s", "--filter", "@oneup/app", "dev"], (l) => {
    if (l.includes("Ready")) {
      console.log(`\n  OneUp is running at ${APP_URL}${LAN ? `\n  On your phone (same Wi-Fi): ${LAN_URLS.join(" or ")}` : ""}\n  Demo trader: demo.test.near (switch to the bots in the account menu)\n  Move a price: curl -XPOST localhost:8787/price -H 'content-type: application/json' -d '{"market":"NEAR-USD","movePct":-2}'\n  Ctrl-C to stop.\n`);
    }
  }, LAN ? { ONEUP_HOST: "0.0.0.0" } : {});
});
