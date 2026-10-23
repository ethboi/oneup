import { test } from "node:test";
import assert from "node:assert/strict";
import { pollActivity } from "../src/lib/activity-feed.ts";

test("delayed activity requests serialize, deduplicate, advance monotonically and stop publishing after disposal", async () => {
  const timers: (() => void)[] = [], cursors: number[] = [], published: { seq: number }[][] = [];
  let done!: (items: { seq: number }[]) => void;
  const stop = pollActivity(after => { cursors.push(after); return new Promise<{seq:number}[]>(r => { done = r; }); }, x => published.push(x), 3, 1,
    fn => { timers.push(fn); return 1 as any; }, () => { timers.length = 0; });
  assert.deepEqual(cursors, [0]); assert.equal(timers.length, 0);
  done([{seq: 3}, {seq: 1}, {seq: 3}, {seq: 2}]);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(published[0].map(x => x.seq), [3, 2, 1]);
  timers.shift()!(); done([{seq: 2}, {seq: 4}, {seq: 4}]);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(cursors, [0, 3]); assert.deepEqual(published[1].map(x => x.seq), [4, 3, 2]);
  timers.shift()!(); stop(); done([{seq: 5}]);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(cursors, [0, 3, 4]); assert.equal(published.length, 2); assert.equal(timers.length, 0);
});
