import { test } from "node:test";
import assert from "node:assert/strict";
import { latestJackpotWin } from "../src/lib/jackpot.ts";
import type { ActivityItem } from "../src/lib/server/activity.ts";

test("a rollover without tickets cannot announce that someone won the retained jackpot", () => {
  const won: ActivityItem = { seq: 1, t: 1, kind: "jackpot", who: "demo", amount: "630170000", text: "demo won", draw: { epoch: 4 } };
  const rolled: ActivityItem = { seq: 2, t: 2, kind: "jackpot", amount: "997760000", text: "rollover", draw: { epoch: 8 } };
  assert.equal(latestJackpotWin([rolled]), undefined);
  assert.equal(latestJackpotWin([won, rolled]), won);
  assert.equal(latestJackpotWin([{ ...won, amount: "0" }]), undefined);
  const next = { ...won, seq: 3, who: "bot1" };
  assert.equal(latestJackpotWin([won, rolled, next]), next);
});
