import { test } from "node:test";
import assert from "node:assert/strict";
import { allowed, checkRpc } from "../src/lib/server/rpc.ts";

const req = (method: string) => ({ jsonrpc: "2.0", id: 1, method, params: [] });

test("rpc proxy allows what near-api-js uses", () => {
  for (const m of ["query", "block", "chunk", "tx", "status", "send_tx", "broadcast_tx_commit", "EXPERIMENTAL_tx_status", "gas_price"]) assert.ok(allowed(m), m);
  assert.equal(checkRpc(JSON.stringify(req("status"))), null);
  assert.equal(checkRpc(JSON.stringify([req("status"), req("query")])), null);
});

test("rpc proxy refuses the sandbox's methods, batches hiding them and big bodies", () => {
  for (const m of ["sandbox_patch_state", "sandbox_fast_forward", "adv_produce_blocks", "", "constructor", "toString"]) assert.equal(allowed(m), false, m);
  assert.equal(allowed(undefined), false);
  assert.equal(checkRpc(JSON.stringify(req("sandbox_patch_state")))?.status, 403);
  assert.equal(checkRpc(JSON.stringify([req("status"), req("sandbox_fast_forward")]))?.status, 403);
  assert.equal(checkRpc("[]")?.status, 400);
  assert.equal(checkRpc("null")?.status, 403);
  assert.equal(checkRpc("{")?.status, 400);
  assert.equal(checkRpc(JSON.stringify({ ...req("status"), pad: "x".repeat(70_000) }))?.status, 413);
});
