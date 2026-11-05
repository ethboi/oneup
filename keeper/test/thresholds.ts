import { test } from "node:test";
import assert from "node:assert/strict";
import type { Order, Position } from "@oneup/sdk";
import { crossesThreshold } from "../src/thresholds.ts";

const USD = (x: number) => BigInt(Math.round(x * 1e8));
const position = (over: Partial<Position> = {}) =>
  ({ id: 1, owner: "a", market_id: "NEAR-USD", side: "Long", margin: "1000000", leverage: 1000, entry_price: USD(100).toString(), entry_publish_time: 0, opened_at: 0, close_order: null, triggers_set_at: 0, triggers: { take_profit: null, stop_loss: null }, ...over }) as unknown as Position;
const limit = (side: "Long" | "Short", at: number) => ({ id: 1, market_id: "NEAR-USD", placed_at: 0, kind: { Open: { side, limit: USD(at).toString() } } }) as unknown as Order;
const cross = (pushed: number | undefined, fresh: number, ps: Position[], os: Order[] = [], market = "NEAR-USD") =>
  crossesThreshold(market, pushed === undefined ? undefined : USD(pushed), USD(fresh), ps, os, 1_000, 60);

test("a small move that crosses a 1000× position's liquidation line counts", () => {
  assert.equal(cross(99.95, 99.9, [position()]), true);
});
test("a small move that crosses nothing doesn't", () => {
  assert.equal(cross(100, 99.98, [position()]), false);
});
test("a position already past its line doesn't force a push on every check", () => {
  assert.equal(cross(99.8, 99.7, [position()]), false);
});
test("another market's position doesn't count", () => {
  assert.equal(cross(99.95, 99.9, [position({ market_id: "BTC-USD" })]), false);
});
test("a trigger counts only after the minimum hold", () => {
  const stop = { take_profit: null, stop_loss: USD(99.97).toString() };
  assert.equal(cross(99.98, 99.96, [position({ triggers: stop, opened_at: 0 })]), true);
  assert.equal(cross(99.98, 99.96, [position({ triggers: stop, opened_at: 990 })]), false);
});
test("a resting limit counts when the price reaches it, on either side", () => {
  assert.equal(cross(100.01, 100, [], [limit("Long", 100)]), true);
  assert.equal(cross(99.99, 100, [], [limit("Short", 100)]), true);
  assert.equal(cross(100.02, 100.01, [], [limit("Long", 100)]), false);
});
