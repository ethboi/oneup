import { test } from "node:test";
import assert from "node:assert/strict";
import { lockOrigin, lockCountdown } from "../src/lib/locks.ts";

test("house reward metadata also describes backing rewards without claiming a trading loss", () => {
  assert.equal(lockOrigin({ merged: 0, from_loss: true, created: 3 }), "House reward locked in round 3");
  assert.equal(lockOrigin({ merged: 0, from_loss: false, created: 3 }), "Locked in round 3");
  assert.equal(lockOrigin({ merged: 2, from_loss: true, created: 3 }), "Merged from 2 locks");
});
test("zero remaining earning periods does not describe an immature lock as unlocked", () => {
  assert.equal(lockCountdown(7, 5), "Unlocks in round 7, 2 rounds to go");
  assert.equal(lockCountdown(7, 6), "Unlocks next round");
  assert.equal(lockCountdown(7, 7), "Ready to unlock");
  assert.equal(lockCountdown(7, 8), "Ready to unlock");
});
