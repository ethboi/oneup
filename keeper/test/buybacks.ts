import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileBuybacks, restoreBuybacks, type BuybackPort } from "../src/buybacks.ts";

test("buybacks survive failed quotes, zero liquidity, refused swaps and restarts; delivery never reswaps", async () => {
  const statuses = new Map<number, any>([[0, "Pending"], [1, { DeliveryPending: { remaining: "7" } }], [2, "Swapping"], [3, { Delivering: { amount: "7" } }]]);
  let fail = true, quote = 0n, swaps = 0, deliveries = 0, checkpoint: unknown;
  const port: BuybackPort = {
    read: async e => statuses.has(e) ? { status: statuses.get(e), usdc: "100" } : null,
    quote: async () => { if (fail) throw Error("offline"); return quote; },
    swap: async (e, min) => { swaps++; assert.ok(min > 0n); if (swaps > 1) statuses.set(e, "Done"); },
    deliver: async e => { deliveries++; statuses.set(e, "Done"); },
  };
  let queue = restoreBuybacks(null, "chain");
  const save = (q: typeof queue) => { checkpoint = JSON.parse(JSON.stringify({ identity: "chain", ...q })); };
  await reconcileBuybacks(port, queue, 5, save, () => {}, 20, 10);
  assert.equal(deliveries, 1); assert.equal(swaps, 0);
  queue = restoreBuybacks(checkpoint, "chain");
  fail = false;
  await reconcileBuybacks(port, queue, 5, save, () => {}, 20, 10);
  assert.equal(swaps, 0);
  quote = 1n;
  await reconcileBuybacks(port, queue, 5, save, () => {}, 20, 10);
  assert.equal(swaps, 1); assert.ok(queue.pending.includes(0));
  queue = restoreBuybacks(checkpoint, "chain");
  await reconcileBuybacks(port, queue, 5, save, () => {}, 20, 10);
  await reconcileBuybacks(port, queue, 5, save, () => {}, 20, 10);
  assert.equal(swaps, 2); assert.equal(deliveries, 1); assert.deepEqual(queue.pending, [2, 3]);
});

test("history reconciliation is bounded, fair and deployment scoped", async () => {
  const read: number[] = [];
  const port: BuybackPort = { read: async e => { read.push(e); return { status: "Swapping", usdc: "1" }; }, quote: async () => 0n, swap: async () => {}, deliver: async () => {} };
  const q = restoreBuybacks(null, "a");
  await reconcileBuybacks(port, q, 10000, () => {}, () => {});
  assert.equal(q.nextEpoch, 20); assert.equal(read.length, 23);
  await reconcileBuybacks(port, q, 10000, () => {}, () => {});
  assert.deepEqual(read.slice(20, 23), [0, 1, 2]);
  assert.deepEqual(read.slice(-3), [3, 4, 5]);
  assert.deepEqual(restoreBuybacks({ identity: "old", ...q }, "new"), { nextEpoch: 0, pending: [] });
  assert.deepEqual(restoreBuybacks({ identity: "a", nextEpoch: 2, pending: [1, 1] }, "a"), { nextEpoch: 0, pending: [] });
});


test("large completed history does not inflate the checkpoint, and failed discovery never skips epochs", async () => {
  let reads = 0, writes = 0, fail = true;
  const q = restoreBuybacks(null, "chain");
  const port: BuybackPort = {
    read: async () => { reads++; if (fail) throw Error("offline"); return {status:"Done",usdc:"1"}; },
    quote: async () => 0n, swap: async () => {}, deliver: async () => {},
  };
  await reconcileBuybacks(port,q,10000,()=>{writes++;},()=>{});
  assert.equal(q.nextEpoch,0);
  fail=false; reads=0; writes=0;
  for(let i=0;i<500;i++) await reconcileBuybacks(port,q,10000,()=>{writes++;assert.equal(q.pending.length,0);},()=>{});
  assert.equal(q.nextEpoch,10000); assert.equal(reads,10000); assert.equal(writes,500);
});
