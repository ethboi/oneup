import { test } from "node:test";
import assert from "node:assert/strict";
import { winTier } from "../src/lib/fx.ts";

const usd = (x: number) => BigInt(Math.round(x * 1e6));

test("a win's tier grows with its dollars", () => {
  assert.equal(winTier(usd(20), usd(10_000)), 0);
  assert.equal(winTier(usd(141.81), usd(10_000)), 1);
  assert.equal(winTier(usd(800), usd(100_000)), 2);
  assert.equal(winTier(usd(3_000), usd(100_000)), 3);
});

test("a small stake that multiplies still counts as big", () => {
  assert.equal(winTier(usd(30), usd(10)), 2); // 3× margin
  assert.equal(winTier(usd(60), usd(10)), 3); // 6× margin, over halfway to the 9× cap
});
