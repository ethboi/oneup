import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLocalnet, guard, hostOk, publicConfig } from "../src/lib/server/localnet.ts";
import type { Deployment } from "@oneup/sdk";

const key = (n: number) => `ed25519:${String(n).repeat(40)}`;
const d = {
  network: "localnet",
  rpcUrl: "http://127.0.0.1:3030",
  epochLengthS: 600,
  contracts: { house: "house.test.near", usdc: "usdc.test.near" },
  intents: { verifier: "intents.test.near", poa: "poa.test.near", solver: { id: "solver.test.near", key: key(3) }, assets: [] },
  owner: { id: "test.near", key: key(1) },
  keeper: { id: "keeper.test.near", key: key(2) },
  bots: [{ id: "bot1.test.near", key: key(5) }],
  demo: { id: "demo.test.near", key: key(4) },
  markets: [],
} as unknown as Deployment;

test("publicConfig drops the root, keeper and solver keys", () => {
  const p = publicConfig(d);
  const s = JSON.stringify(p);
  assert.ok(!("owner" in p) && !("keeper" in p));
  assert.deepEqual(p.intents?.solver, { id: "solver.test.near" });
  for (const k of [key(1), key(2), key(3)]) assert.ok(!s.includes(k));
  assert.deepEqual(s.match(/ed25519:[^"]+/g)?.sort(), [key(4), key(5)].sort());
  assert.equal(p.demo.id, "demo.test.near");
});

test("assertLocalnet", () => {
  assertLocalnet(d);
  assertLocalnet({ network: "localnet", rpcUrl: "http://localhost:3030" });
  assert.throws(() => assertLocalnet({ network: "mainnet" as "localnet", rpcUrl: "http://127.0.0.1:3030" }));
  assert.throws(() => assertLocalnet({ network: "localnet", rpcUrl: "https://rpc.mainnet.near.org" }));
  assert.throws(() => assertLocalnet({ network: "localnet", rpcUrl: "http://127.0.0.1.evil.com:3030" }));
});

test("hostOk: loopback and this machine's LAN IPs only", () => {
  const lan = ["192.168.1.20"];
  for (const h of ["127.0.0.1:3020", "localhost:3020", "LOCALHOST", "[::1]:3020", "192.168.1.20:3020"]) assert.ok(hostOk(h, lan), h);
  for (const h of [null, "", "evil.example:3020", "127.0.0.1.nip.io:3020", "192.168.1.21:3020", "localhost.evil.com"]) assert.equal(hostOk(h, lan), false, String(h));
});

test("guard: foreign Host, and non-JSON posts", () => {
  const r = (host: string, init: RequestInit = {}) => new Request("http://x/api/relay", { ...init, headers: { host, ...(init.headers as object) } });
  assert.equal(guard(r("127.0.0.1:3020")), null);
  assert.equal(guard(r("evil.example"))?.status, 403);
  assert.equal(guard(r("127.0.0.1:3020", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } }))?.status, 415);
  assert.equal(guard(r("127.0.0.1:3020", { method: "POST", body: "{}" }))?.status, 415);
  assert.equal(guard(r("127.0.0.1:3020", { method: "POST", body: "{}", headers: { "content-type": "application/json; charset=utf-8" } })), null);
});
