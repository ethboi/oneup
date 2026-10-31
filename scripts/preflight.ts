// Read-only prerequisite checks. Bind probes close immediately and never stop another process.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, verifyBuildManifest } from "./artifacts.ts";

export type NamedPort = { name: string; port: number };
export type Check = { name: string; ok: boolean; detail: string };
export const toolEnv = { ...process.env, PATH: `${resolve(homedir(), ".cargo/bin")}:${process.env.PATH ?? ""}` };
export function judgePorts(env: NodeJS.ProcessEnv = process.env): NamedPort[] {
  return [
    { name: "app", port: Number(env.ONEUP_JUDGE_APP_PORT ?? 3021) },
    { name: "RPC", port: Number(env.ONEUP_JUDGE_RPC_PORT ?? 3130) },
    { name: "network", port: Number(env.ONEUP_JUDGE_NETWORK_PORT ?? 25567) },
    { name: "price control", port: Number(env.ONEUP_JUDGE_CONTROL_PORT ?? 8887) },
  ];
}
export async function checkPorts(ports: NamedPort[]): Promise<Check[]> {
  const counts = new Map<number, number>();
  for (const { port } of ports) counts.set(port, (counts.get(port) ?? 0) + 1);
  return Promise.all(ports.map(async ({ name, port }): Promise<Check> => {
    const label = `${name} port ${port}`;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return { name: label, ok: false, detail: "Choose an integer port from 1024 to 65535." };
    if (counts.get(port)! > 1) return { name: label, ok: false, detail: "Each judge service needs a different port." };
    return new Promise(resolveCheck => {
      const server = createServer();
      server.once("error", (e: NodeJS.ErrnoException) => resolveCheck({ name: label, ok: false, detail: `${e.code ?? e.message}. Leave that service running and choose another ONEUP_JUDGE_*_PORT.` }));
      server.listen(port, "127.0.0.1", () => server.close(error => resolveCheck({ name: label, ok: !error, detail: error ? error.message : "Available on 127.0.0.1" })));
    });
  }));
}
function command(name: string, executable: string, args: string[], install: string): Check {
  const r = spawnSync(executable, args, { cwd: ROOT, env: toolEnv, encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
  return { name, ok: r.status === 0, detail: r.status === 0 ? ((r.stdout || r.stderr).trim().split("\n")[0] || "Available") : install };
}
export async function preflight(options: { ports?: NamedPort[]; build?: boolean; compile?: boolean } = {}): Promise<Check[]> {
  const packageManager = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).packageManager as string;
  const pinnedPnpm = packageManager.split("@")[1];
  const pnpm = command("pnpm", "pnpm", ["--version"], `Install ${packageManager}; run pnpm install --frozen-lockfile.`);
  if (pnpm.ok && pnpm.detail !== pinnedPnpm) { pnpm.ok = false; pnpm.detail = `Found ${pnpm.detail}; use ${packageManager}.`; }
  const installed = existsSync(resolve(ROOT, "node_modules/.bin/tsx")) && existsSync(resolve(ROOT, "app/node_modules/.bin/next"));
  const sandbox = existsSync(resolve(ROOT, "node_modules/.bin/near-sandbox"));
  const checks: Check[] = [
    { name: "Platform", ok: process.platform === "linux", detail: process.platform === "linux" ? "Linux (the supported CI and sandbox environment)" : "Use Linux or WSL2; this process-group launcher is tested on Linux." },
    { name: "Node.js", ok: Number(process.versions.node.split(".")[0]) >= 24, detail: `Found ${process.version}; CI uses Node 24.13.0.` },
    pnpm,
    { name: "Installed dependencies", ok: installed, detail: installed ? "Found" : "Run pnpm install --frozen-lockfile." },
    { name: "near-sandbox launcher", ok: sandbox, detail: sandbox ? "Found; its first launch downloads the sandbox binary (needs internet access)" : "Run pnpm install --frozen-lockfile." },
  ];
  if (options.compile) {
    const cargoNear = command("cargo-near", "cargo", ["near", "--version"], "Run cargo install --locked cargo-near --version 0.22.0 (it needs the build tools checked below).");
    checks.push(
      command("Rust", "rustc", ["--version"], "Install Rust 1.99.1 with rustup; add ~/.cargo/bin to PATH."),
      cargoNear,
      command("C/C++ compiler", "cc", ["--version"], "Install build-essential."),
    );
    // Only compiling cargo-near itself needs these; the contracts and the sandbox tests build without them.
    if (!cargoNear.ok) checks.push(
      command("Clang", "clang", ["--version"], "Install clang."),
      command("CMake", "cmake", ["--version"], "Install cmake."),
      command("Protocol Buffers", "protoc", ["--version"], "Install protobuf-compiler."),
      command("OpenSSL development files", "pkg-config", ["--modversion", "openssl"], "Install pkg-config and libssl-dev."),
    );
  }
  if (options.build) {
    try { verifyBuildManifest(); checks.push({ name: "Contract build", ok: true, detail: "All nine WASMs match the current Rust/build input manifest." }); }
    catch { checks.push({ name: "Contract build", ok: false, detail: "Run pnpm build:contracts before launching the judge chain." }); }
  }
  checks.push(...await checkPorts(options.ports ?? []));
  return checks;
}
export function requireChecks(checks: Check[]) {
  for (const check of checks) console.log(`${check.ok ? "✓" : "✕"} ${check.name}: ${check.detail}`);
  if (checks.some(check => !check.ok)) throw Error("Preflight failed. Fix the checks above; no chain or app was started.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const judge = process.argv.includes("--judge");
  const compile = process.argv.includes("--compile");
  try { requireChecks(await preflight({ ports: judge ? judgePorts() : [], build: judge, compile })); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
