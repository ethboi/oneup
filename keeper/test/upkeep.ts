import { test } from "node:test";
import assert from "node:assert/strict";
import { GAS_TOP_UP, closeCanContinue, marketsToPrice, spareNear, topUpsDue } from "../src/upkeep.ts";
import { reconcileBuybacks, type BuybackPort } from "../src/buybacks.ts";

const NEAR = 10n ** 24n;

test("spare NEAR is what storage hasn't locked up", () => {
  assert.equal(spareNear({ amount: 6n * NEAR, storage_usage: 300_000 }), 3n * NEAR);
});

test("contracts running low get topped up, lowest first, while the operator can afford it", () => {
  const accounts = [
    { id: "fine", spare: 9n * NEAR },
    { id: "low", spare: NEAR / 2n },
    { id: "lowest", spare: NEAR / 4n },
  ];
  assert.deepEqual(topUpsDue(accounts, 100n * NEAR), { due: ["lowest", "low"], short: [] });
  assert.deepEqual(topUpsDue(accounts, 11n * NEAR), { due: ["lowest"], short: ["low"] });
  assert.deepEqual(topUpsDue(accounts, NEAR), { due: [], short: ["lowest", "low"] });
});

test("bots get a smaller gas top-up from what the contracts leave the operator", () => {
  const bots = [
    { id: "trading", spare: NEAR },
    { id: "dry", spare: NEAR / 10n },
    { id: "nearly", spare: (NEAR * 4n) / 10n },
  ];
  assert.deepEqual(topUpsDue(bots, 100n * NEAR, GAS_TOP_UP), { due: ["dry", "nearly"], short: [] });
  // 8 NEAR spare: one 2 NEAR top-up leaves 6, a second would leave the operator under its 5
  assert.deepEqual(topUpsDue(bots, 8n * NEAR, GAS_TOP_UP), { due: ["dry"], short: ["nearly"] });
});

test("a paused market keeps its prices while anything is open on it", () => {
  const markets = [
    { id: "A", live: true },
    { id: "B", live: false },
    { id: "C", live: false },
    { id: "D", live: false },
  ];
  const ids = marketsToPrice(markets, [{ market_id: "B" }], [{ market_id: "C" }]).map((m) => m.id);
  assert.deepEqual(ids, ["A", "B", "C"]);
});

test("a round close that's waiting or retrying gives way to the rest of the tick", () => {
  for (const step of ["waiting for mints", "waiting for recall", "waiting for expiry", "waiting for backing", "waiting for pot", "retrying recovery"] as const) assert.equal(closeCanContinue(step), false, step);
  for (const step of ["begun", "minting", "expiring", "recalling", "drawing jackpot"] as const) assert.equal(closeCanContinue(step), true, step);
});

test("a round still closing isn't scanned past, so its buyback isn't missed", async () => {
  const buybacks = new Map<number, { status: "Pending"; usdc: string }>();
  const swapped: number[] = [];
  const port: BuybackPort = {
    read: async (epoch) => buybacks.get(epoch) ?? null,
    quote: async () => 10n,
    swap: async (epoch) => void swapped.push(epoch),
    deliver: async () => {},
  };
  const queue = { nextEpoch: 5, pending: [] as number[] };
  // round 5 is still closing: the keeper asks only for rounds before it
  await reconcileBuybacks(port, queue, 5, () => {}, () => {});
  assert.equal(queue.nextEpoch, 5);
  buybacks.set(5, { status: "Pending", usdc: "100" });
  await reconcileBuybacks(port, queue, 6, () => {}, () => {});
  assert.deepEqual(swapped, [5]);
});
