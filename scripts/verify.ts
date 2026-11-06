// Complete local gate. Logs and evidence are private ignored build artifacts, never credentials.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, sourceIdentity, sha256, copyApp } from "./artifacts.ts";
const dir = resolve(ROOT, ".verification"); mkdirSync(dir, {recursive:true});
const source = sourceIdentity();
const appDir = copyApp(resolve(dir,`app-${Date.now()}`));
const steps = [
  ["Secret scan", ["exec", "tsx", "scripts/check-secrets.ts"]],
  ["Root typecheck", ["exec", "tsc", "--noEmit"]],
  ["Workspace typecheck", ["-r", "typecheck"]],
  ["Rust, SDK and model tests", ["test"]],
  ["App and keeper regressions", ["test:ts"]],
  ["Fresh WASM sandbox tests", ["test:sandbox"]],
  ["Deployment inspection regression", ["exec", "node", "--import", "tsx", "--test", "scripts/test/*.ts"]],
  ["Economic sensitivity", ["sim:sensitivity"]],
  ["Production app build", ["--filter", "@oneup/app", "build"]],
] as const;
const results: {name:string; command:string; exitCode:number|null; logSha256:string}[] = [];
for (const [name, args] of steps) {
  console.log(`\n${name}`);
  const appBuild = name === "Production app build";
  const commandArgs = appBuild ? ["exec", "next", "build"] : [...args];
  const r = spawnSync("pnpm", commandArgs, {cwd:appBuild ? appDir : ROOT, env:{...process.env, ONEUP_NEXT_DIST:".next-verify"}, encoding:"utf8", maxBuffer:100*1024*1024});
  const log = (r.stdout ?? "") + (r.stderr ?? "") + (r.error ? String(r.error) : "");
  process.stdout.write(log);
  const file = `${results.length+1}.log`; writeFileSync(resolve(dir,file),log);
  results.push({name,command:`pnpm ${args.join(" ")}`,exitCode:r.status,logSha256:sha256(log)});
  const finishedSource = sourceIdentity();
  const stable = JSON.stringify(source) === JSON.stringify(finishedSource);
  writeFileSync(resolve(dir,"verification.json"),JSON.stringify({source,finishedSource,sourceStable:stable,checkedAt:new Date().toISOString(),node:process.version,results,passed:stable && results.length===steps.length && results.every(s=>s.exitCode===0)},null,2));
  if (r.status !== 0) process.exit(r.status || 1);
  if (!stable) { console.error("Source changed during verification; run pnpm verify again after edits stop."); process.exit(1); }
}
console.log("Complete verification passed; .verification/verification.json binds logs to the source revision and working changes.");
