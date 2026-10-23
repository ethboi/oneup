import { test } from "node:test";
import assert from "node:assert/strict";
import { pollSerial } from "../src/lib/poll.ts";

test("slow polls never overlap and cancelled identities cannot publish stale data", async () => {
  const queued: (() => void)[] = [];
  let resolve!: (value: number) => void;
  let calls = 0;
  const published: number[] = [];
  const schedule = (fn: () => void) => { queued.push(fn); return 1 as unknown as ReturnType<typeof setTimeout>; };
  const stop = pollSerial(() => { calls++; return new Promise<number>(r => { resolve = r; }); }, n => published.push(n), 1, schedule, () => {});
  assert.equal(calls, 1);
  assert.equal(queued.length, 0);
  resolve(1);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(published, [1]);
  assert.equal(queued.length, 1);
  queued.shift()!();
  assert.equal(calls, 2);
  stop();
  resolve(2);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(published, [1]);
  assert.equal(queued.length, 0);
});
