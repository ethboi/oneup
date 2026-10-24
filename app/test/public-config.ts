import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTestnetConfig } from "../src/lib/app-config.ts";
import { deployment, guard, publicConfig } from "../src/lib/server/localnet.ts";
const fixture = () => ({
  network: "testnet", rpcUrl: "https://rpc.testnet.near.org", epochLengthS: 600,
  contracts: Object.fromEntries(["house", "life", "oneup", "ve", "usdc", "oracle", "swap", "market"].map(n => [n, n + ".project.testnet"])),
  markets: [{ id: "NEAR-USD", feedId: "a".repeat(64), simPrice: 5 }],
  testUsdcFaucet: true,
});
test("public testnet configuration strips every private or unrecognized field recursively", () => {
  const raw = { ...fixture(), owner: { key: "private-owner" }, demo: { key: "private-demo" }, bots: [{ key: "private-bot" }], intents: { solver: { key: "private-solver" } } };
  raw.contracts.secret = "private-contract"; (raw.markets[0] as any).key = "private-market";
  const p = parseTestnetConfig(raw), serialized = JSON.stringify(p);
  assert.ok(!serialized.includes("private"));
  assert.deepEqual(p.bots, []);
  assert.equal(p.demo, undefined);
  assert.equal(p.intents, undefined);
  assert.equal(p.testUsdcFaucet, true);
});
test("public profile refuses mainnet, local RPCs, credentials in URLs, and wrong-network contracts", () => {
  for (const rpcUrl of ["http://rpc.testnet.near.org", "http://127.0.0.1:3030", "https://rpc.mainnet.near.org", "https://user:secret@rpc.testnet.near.org", "https://rpc.testnet.near.org/?key=secret"]) {
    assert.throws(() => parseTestnetConfig({ ...fixture(), rpcUrl }));
  }
  assert.throws(() => parseTestnetConfig({ ...fixture(), network: "mainnet" }));
  assert.throws(() => parseTestnetConfig({ ...fixture(), contracts: { ...fixture().contracts, house: "house.near" } }));
  assert.throws(() => parseTestnetConfig({ ...fixture(), epochLengthS: 0 }));
  assert.throws(() => publicConfig(fixture() as any), /Localnet only/);
});
test("enabling public profile disables local privileged routes even on localhost and never falls back to local keys", () => {
  const prior = process.env.ONEUP_PUBLIC_CONFIG;
  try {
    process.env.ONEUP_PUBLIC_CONFIG = "/missing/testnet-public.json";
    assert.equal(guard(new Request("http://localhost/api/relay", { headers: { host: "localhost" } }))?.status, 404);
    assert.throws(() => deployment(), /disabled/);
  } finally {
    if (prior === undefined) delete process.env.ONEUP_PUBLIC_CONFIG; else process.env.ONEUP_PUBLIC_CONFIG = prior;
  }
});
