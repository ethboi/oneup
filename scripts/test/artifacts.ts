import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {CONTRACT_WASMS,ROOT,inspectDeployment,sourceIdentity,verifyBuildManifest} from "../artifacts.ts";
import type {Deployment} from "@oneup/sdk";

test("deployment inspection detects one stale contract without changing source or chain state", async () => {
  verifyBuildManifest();
  const before=sourceIdentity(); let stale=false;
  const server=createServer(async(req,res)=>{
    let body=""; for await(const chunk of req) body+=chunk;
    const {id}=JSON.parse(body);
    const wasm=CONTRACT_WASMS[id as keyof typeof CONTRACT_WASMS];
    const bytes=stale && id==="house" ? Buffer.from("old deployed code") : readFileSync(resolve(ROOT,`contracts/target/near/${wasm}/${wasm}.wasm`));
    res.setHeader("content-type","application/json"); res.end(JSON.stringify({result:{code_base64:bytes.toString("base64")}}));
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  try {
    const port=(server.address() as {port:number}).port;
    const d={network:"localnet",rpcUrl:`http://127.0.0.1:${port}`,contracts:Object.fromEntries(Object.keys(CONTRACT_WASMS).map(name=>[name,`${name}.test.near`]))} as Deployment;
    assert.ok((await inspectDeployment(d)).every(c=>c.matches));
    stale=true;
    const mismatch=(await inspectDeployment(d)).filter(c=>!c.matches);
    assert.deepEqual(mismatch.map(c=>c.name),["house"]);
    assert.deepEqual(sourceIdentity(),before);
  } finally { await new Promise<void>((ok,no)=>server.close(e=>e?no(e):ok())); }
});
