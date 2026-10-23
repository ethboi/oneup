import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, CONTRACT_WASMS, contractsInputHash, sha256, sourceIdentity } from "./artifacts.ts";
const dir=resolve(ROOT,"contracts/target/near"); mkdirSync(dir,{recursive:true});
const start=resolve(dir,"build-start.json"), manifest=resolve(dir,"build-manifest.json");
if(process.argv[2]==="begin") {
  rmSync(manifest,{force:true});
  writeFileSync(start,JSON.stringify({source:sourceIdentity(),contractsInputSha256:contractsInputHash()}));
} else {
  const before=JSON.parse(readFileSync(start,"utf8"));
  if(before.contractsInputSha256!==contractsInputHash()) throw Error("Rust inputs changed while compiling; rebuild");
  const wasms=Object.fromEntries(Object.values(CONTRACT_WASMS).map(wasm=>[wasm,sha256(readFileSync(resolve(dir,`${wasm}/${wasm}.wasm`)))]));
  writeFileSync(manifest,JSON.stringify({...before,builtAt:new Date().toISOString(),rust:execFileSync("rustc",["--version"],{encoding:"utf8"}).trim(),wasms},null,2));
}
