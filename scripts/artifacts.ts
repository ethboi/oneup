import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, cpSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Deployment } from "@oneup/sdk";
export const ROOT = resolve(import.meta.dirname, "..");
export const CONTRACT_WASMS = { house: "oneup_house", life: "oneup_extra_life", oneup: "oneup_token", ve: "oneup_ve", market: "oneup_market", usdc: "mock_usdc", oracle: "mock_oracle", swap: "mock_swap", vault: "mock_vault" } as const;
export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export function sourceIdentity() {
  const git = (...args: string[]) => execFileSync("git", args, {cwd: ROOT, encoding: "utf8"}).trim();
  const changed = git("status", "--porcelain");
  const tracked = execFileSync("git", ["diff", "--binary", "HEAD"], {cwd: ROOT});
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean).sort();
  const hash = createHash("sha256").update(tracked);
  for (const path of untracked) hash.update(path).update("\0").update(readFileSync(resolve(ROOT, path)));
  return { revision: git("rev-parse", "HEAD"), dirty: !!changed, workingChangesSha256: hash.digest("hex") };
}
export async function inspectDeployment(d: Deployment) {
  verifyBuildManifest();
  if (d.network !== "localnet" || !["127.0.0.1", "localhost"].includes(new URL(d.rpcUrl).hostname)) throw Error("Local deployment verification only");
  return Promise.all(Object.entries(CONTRACT_WASMS).map(async ([name, wasm]) => {
    const account = d.contracts[name as keyof typeof CONTRACT_WASMS];
    const expected = sha256(readFileSync(resolve(ROOT, `contracts/target/near/${wasm}/${wasm}.wasm`)));
    const response = await fetch(d.rpcUrl, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: name, method: "query", params: { request_type: "view_code", finality: "final", account_id: account }})});
    const result = await response.json();
    if (!response.ok || result.error || !result.result?.code_base64) throw Error(`Cannot verify ${name}: ${JSON.stringify(result.error ?? response.status)}`);
    const deployed = sha256(Buffer.from(result.result.code_base64, "base64"));
    return {name, account, builtSha256: expected, deployedSha256: deployed, matches: expected === deployed};
  }));
}

/** All local Rust/build inputs, excluding cached output and unchanged third-party binaries. */
export function contractsInputHash() {
  const files: string[] = [];
  const walk = (dir: string) => { for (const e of readdirSync(resolve(ROOT,dir), {withFileTypes:true})) {
    if (["target", "vendor", ".git"].includes(e.name)) continue;
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(path);
    else if (e.name.endsWith(".rs") || ["Cargo.toml", "Cargo.lock", "build.sh", "config.toml", "rust-toolchain", "rust-toolchain.toml"].includes(e.name)) files.push(path);
  }};
  walk("contracts"); const hash=createHash("sha256");
  for(const path of files.sort()) hash.update(path).update("\0").update(readFileSync(resolve(ROOT,path)));
  return hash.digest("hex");
}
export function verifyBuildManifest() {
  const manifest = JSON.parse(readFileSync(resolve(ROOT,"contracts/target/near/build-manifest.json"),"utf8"));
  if (manifest.contractsInputSha256 !== contractsInputHash()) throw Error("Rust/build inputs changed: run pnpm build:contracts");
  for(const wasm of Object.values(CONTRACT_WASMS)) {
    if(manifest.wasms[wasm] !== sha256(readFileSync(resolve(ROOT,`contracts/target/near/${wasm}/${wasm}.wasm`)))) throw Error(`Build artifact changed: ${wasm}`);
  }
  return manifest;
}
/** A source snapshot with its own generated Next inputs. Only dependencies are shared read-only. */
function includeAppEntry(name: string) {
  const dotenv = name === ".env" || name.startsWith(".env.") || name === ".envrc";
  const example = [".example", ".sample", ".template"].some(suffix => name.endsWith(suffix));
  return (!dotenv || example) && name !== "node_modules" && !name.startsWith(".next") && !name.startsWith(".oneup-tsconfig") && name !== "next-env.d.ts" && !name.endsWith(".tsbuildinfo");
}
export function copyApp(destination: string, sourceDirectory = resolve(ROOT, "app")) {
  mkdirSync(destination,{recursive:true});
  cpSync(sourceDirectory,destination,{recursive:true,filter:source => {
    const name=source.split("/").at(-1)!;
    return source === sourceDirectory || includeAppEntry(name);
  }});
  const models=resolve(ROOT,"sim/out");
  if(existsSync(models)) cpSync(models,resolve(destination,"../sim/out"),{recursive:true});
  symlinkSync(resolve(sourceDirectory,"node_modules"),resolve(destination,"node_modules"),"dir");
  return destination;
}

export function appInputHash(directory = resolve(ROOT,"app")) {
  const hash = createHash("sha256");
  const walk = (dir:string, prefix="") => { for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    if(!includeAppEntry(e.name)) continue;
    const relative=`${prefix}/${e.name}`, path=resolve(dir,e.name);
    if(e.isDirectory()) walk(path,relative); else hash.update(relative).update("\0").update(readFileSync(path));
  }};
  walk(directory); return hash.digest("hex");
}
