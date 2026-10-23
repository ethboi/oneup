import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspectDeployment, sourceIdentity, verifyBuildManifest } from "./artifacts.ts";
const config = process.env.ONEUP_CONFIG ?? resolve(import.meta.dirname, "../localnet.json");
const contracts = await inspectDeployment(JSON.parse(readFileSync(config, "utf8")));
const manifest = {build: verifyBuildManifest(), source: sourceIdentity(), checkedAt: new Date().toISOString(), contracts};
const output = process.env.ONEUP_DEPLOYMENT_REPORT ?? resolve(import.meta.dirname, "../.verification/deployment.json");
mkdirSync(resolve(output, ".."), {recursive: true});
writeFileSync(output, JSON.stringify(manifest, null, 2));
console.table(contracts.map(({name, matches}) => ({name, matches})));
if (contracts.some(c => !c.matches)) { console.error("Stale deployment: use a separate fresh judge chain; existing state was preserved."); process.exitCode = 1; }
