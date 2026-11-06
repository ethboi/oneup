import { test } from "node:test";
import assert from "node:assert/strict";
import { lockOrigin, lockCountdown } from "../src/lib/locks.ts";

test("house reward metadata also describes backing rewards without claiming a trading loss", () => {
  assert.equal(lockOrigin({ merged: 0, from_loss: true, created: 3 }), "Reward for round 3");
  assert.equal(lockOrigin({ merged: 0, from_loss: false, created: 3 }), "Locked in round 3");
  assert.equal(lockOrigin({ merged: 2, from_loss: true, created: 3 }), "Merged from 2 locks");
});
test("zero remaining earning periods does not describe an immature lock as unlocked", () => {
  assert.equal(lockCountdown(7, 5), "Unlocks in round 7 · 2 rounds remaining");
  assert.equal(lockCountdown(7, 6), "Unlocks next round");
  assert.equal(lockCountdown(7, 7), "Ready to unlock");
  assert.equal(lockCountdown(7, 8), "Ready to unlock");
});


test("reward checks cover every round since the oldest lock, skipping those already settled", async () => {
  const { isSettledRound, roundsToCheck } = await import("../src/lib/locks.ts");
  assert.deepEqual(roundsToCheck(5, 9, new Set()), [8, 7, 6, 5]);
  assert.deepEqual(roundsToCheck(5, 9, new Set([6, 7])), [8, 5]);
  assert.equal(roundsToCheck(0, 500, new Set()).length, 25, "a long history fills in a few at a time");
  assert.equal(isSettledRound(95, 100), true);
  assert.equal(isSettledRound(97, 100), false, "rewards can still land on a recent round");
});
