import { test } from "node:test";
import assert from "node:assert/strict";
import { STALLED_AFTER_MS, readFailed, readGone, readOk, stalledReads } from "../src/lib/read-health.ts";

const refused = new Error("429 Too Many Requests");

test("read health: a read is stalled once the RPC has not answered it for a while, and not before", () => {
  const poll = {};
  readFailed(poll, refused, 1_000);
  assert.equal(stalledReads(1_000_000).count, 0, "one refusal is ordinary, however long until the read is next made");
  // later failures keep the time of the first
  readFailed(poll, new TypeError("Failed to fetch"), 9_000);
  assert.equal(stalledReads(1_000 + STALLED_AFTER_MS - 1).count, 0, "two failures a few seconds apart are not yet a stall");
  assert.deepEqual(stalledReads(1_000 + STALLED_AFTER_MS), { count: 1, error: "429 Too Many Requests" });
  readOk(poll);
  assert.equal(stalledReads(1_000_000).count, 0, "an answer clears it");
});

test("read health: an answer from the contract is not an unreachable chain", () => {
  const poll = {};
  readFailed(poll, refused, 0);
  readFailed(poll, new Error("Smart contract panicked: No such position"), 5_000);
  assert.equal(stalledReads(1_000_000).count, 0);
});

test("read health: a poll that stops is forgotten, and the others are counted", () => {
  const a = {}, b = {};
  for (const at of [0, 1_000]) readFailed(a, refused, at);
  for (const at of [2_000, 3_000]) readFailed(b, refused, at);
  assert.equal(stalledReads(STALLED_AFTER_MS + 2_000).count, 2);
  readGone(a);
  assert.equal(stalledReads(STALLED_AFTER_MS + 2_000).count, 1);
  readGone(b);
});
