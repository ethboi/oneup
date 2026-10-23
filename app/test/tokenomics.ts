import { test } from "node:test";
import assert from "node:assert/strict";
import { TokenomicsReader } from "../src/lib/tokenomics.ts";

test("history and totals include carry releases after epoch208 and cache completed rows", async () => {
  const queried: number[] = [];
  const reader = new TokenomicsReader({
    epochSummary: async () => null,
    emissions: async epoch => { queried.push(epoch); return { epoch, scheduled: "0", released: epoch > 208 ? "20" : "1", locked: "1", carry: "0" }; },
    buyback: async () => ({ usdc: "3", status: "Done" }),
  });
  const first = await reader.read(208);
  assert.equal(first.history.length, 208);
  queried.length = 0;
  const next = await reader.read(209);
  assert.deepEqual(queried, [209]);
  assert.equal(next.history.length, 209);
  assert.equal(next.history.at(-1)?.released, "20");
  assert.equal(next.buybacks, 627n);
});

test("a buyback first observed during closing is refreshed after another epoch starts", async () => {
  const queried: number[] = [];
  let finished = false;
  const reader = new TokenomicsReader({
    epochSummary: async () => null,
    emissions: async epoch => ({ epoch, scheduled: "0", released: "0", locked: "0", carry: "0" }),
    buyback: async epoch => { queried.push(epoch); return finished && epoch === 1 ? { usdc: "7", status: "Done" } : null; },
  });
  assert.equal((await reader.read(1)).buybacks, 0n);
  queried.length = 0;
  finished = true;
  assert.equal((await reader.read(2)).buybacks, 7n);
  assert.deepEqual(queried, [1, 2]);
});

test("completed zero-pot epochs are cached without hiding unfinished closes", async () => {
  const queried: number[] = [];
  const reader = new TokenomicsReader({
    epochSummary: async epoch => epoch === 1 ? { buyback_pot: "0" } : null,
    emissions: async () => null,
    buyback: async epoch => { queried.push(epoch); return null; },
  });
  await reader.read(2);
  queried.length = 0;
  await reader.read(3);
  assert.deepEqual(queried, [2, 3]);
});
