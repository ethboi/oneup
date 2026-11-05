import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveSource, SimSource, sane } from "../src/prices.ts";
import { validSteer } from "../src/control.ts";

const json = { "content-type": "application/json" };
const prices = new Map([["NEAR-USD", 2]]);
const steer = (body: object | string, headers: Record<string, string> = json) =>
  validSteer(typeof body === "string" ? body : JSON.stringify(body), headers, prices);

test("steer: valid requests", () => {
  assert.deepEqual(steer({ market: "NEAR-USD", price: 2.5 }), { market: "NEAR-USD", target: 2.5 });
  assert.deepEqual(steer({ market: "NEAR-USD", movePct: -2 }), { market: "NEAR-USD", target: 1.96 });
  assert.deepEqual(steer({ market: "NEAR-USD", movePct: 50 }), { market: "NEAR-USD", target: 3 });
});

test("steer: refuses browsers, non-JSON and bad values", () => {
  const status = (v: ReturnType<typeof steer>) => ("status" in v ? v.status : 200);
  assert.equal(status(steer({ market: "NEAR-USD", price: 2.1 }, { ...json, origin: "https://evil.example" })), 403);
  assert.equal(status(steer({ market: "NEAR-USD", price: 2.1 }, { ...json, origin: "http://127.0.0.1:3020" })), 403);
  assert.equal(status(steer({ market: "NEAR-USD", price: 2.1 }, { "content-type": "text/plain" })), 415);
  assert.equal(status(steer({ market: "NEAR-USD", price: 2.1 }, {})), 415);
  for (const b of [
    { market: "NEAR-USD", price: 0 },
    { market: "NEAR-USD", price: -1 },
    { market: "NEAR-USD", price: "2" },
    { market: "NEAR-USD", movePct: -50 },
    { market: "NEAR-USD", movePct: 50.1 },
    { market: "NEAR-USD", movePct: "5" },
    { market: "NEAR-USD", price: 100 },
    { market: "NEAR-USD", price: 2, movePct: 1 },
    { market: "NEAR-USD" },
    { market: "DOGE-USD", price: 1 },
  ])
    assert.equal(status(steer(b)), 400, JSON.stringify(b));
  assert.equal(status(steer('{"market":"NEAR-USD","price":1e999}')), 400); // Infinity
  assert.equal(status(steer("{")), 400);
});

test("sane: drops NaN, zero, negative and jumps over 20%", () => {
  assert.equal(sane(undefined, 2), null);
  assert.equal(sane(2, 2.3), null);
  assert.ok(sane(2, NaN));
  assert.ok(sane(undefined, 0));
  assert.ok(sane(2, -1));
  assert.ok(sane(2, Infinity));
  assert.ok(sane(2, 2.5)?.startsWith("jump"));
  assert.ok(sane(2, 1.5)?.startsWith("jump"));
});

test("live prices: stamped before the fetch, and a missing market is skipped", async () => {
  const logs: unknown[] = [];
  let fetchedAt = 0;
  const src = new LiveSource(
    (...m) => logs.push(m.join(" ")),
    async () => {
      fetchedAt = Math.floor(Date.now() / 1000);
      await new Promise((r) => setTimeout(r, 1100));
      return new Map([["NEAR-USD", 2], ["ETH-USD", NaN]]);
    },
  );
  const out = await src.next([
    { id: "NEAR-USD", feedId: "a" },
    { id: "ETH-USD", feedId: "b" },
    { id: "BTC-USD", feedId: "c" },
  ]);
  assert.deepEqual(out.map((u) => u.feed_id), ["a"]);
  assert.ok(out[0].publish_time <= fetchedAt);
  assert.equal(logs.length, 2);
});

test("sim steer: a zero or bad target is refused, not divided by", async () => {
  const sim = new SimSource([{ id: "NEAR-USD", feedId: "a", simPrice: 2 } as never], 0);
  assert.throws(() => sim.steer("NEAR-USD", 0));
  assert.throws(() => sim.steer("NEAR-USD", NaN));
  sim.steer("NEAR-USD", 2.2);
  for (let i = 0; i < 20; i++) await sim.next([{ id: "NEAR-USD", feedId: "a" }]);
  assert.equal(sim.prices.get("NEAR-USD"), 2.2);
});

test("priceDue pushes on a move, on age, or when nothing was pushed yet", async () => {
  const { priceDue } = await import("../src/prices.ts");
  const last = { price: 100, at: 0 };
  assert.equal(priceDue(undefined, 100, 0, 10, 60_000), true);
  assert.equal(priceDue(last, 100.05, 1_000, 10, 60_000), false); // 5 bps
  assert.equal(priceDue(last, 100.1, 1_000, 10, 60_000), true); // 10 bps
  assert.equal(priceDue(last, 99.9, 1_000, 10, 60_000), true); // down too
  assert.equal(priceDue(last, 100, 60_000, 10, 60_000), true); // stale
  assert.equal(priceDue(last, 100, 1_000, 0, 60_000), true); // 0: always, as on localnet
});
