import { test } from "node:test";
import assert from "node:assert/strict";
import { ReadShare } from "../src/lib/shared-reads.ts";

test("the same question asked at the same moment is sent once, and asked again once the hold has passed", async () => {
  let t = 0;
  let sent = 0;
  const reads = new ReadShare(1000, () => t);
  const lives = () => reads.get("life lives_for_owner {\"account_id\":\"a.testnet\"}", async () => ++sent);
  // the header, the form and the walkthrough, on the same tick
  assert.deepEqual(await Promise.all([lives(), lives(), lives()]), [1, 1, 1]);
  t = 999;
  assert.equal(await lives(), 1);
  // the next poll, eight seconds on, reads the chain again
  t = 8000;
  assert.equal(await lives(), 2);
  assert.equal(sent, 2);
});

test("a different account, contract or argument is a different question", async () => {
  const reads = new ReadShare(1000, () => 0);
  const sent: string[] = [];
  const ask = (key: string) => reads.get(key, async () => (sent.push(key), key));
  await Promise.all([ask("usdc ft_balance_of a"), ask("usdc ft_balance_of b"), ask("oneup ft_balance_of a"), ask("usdc ft_balance_of a")]);
  assert.deepEqual(sent, ["usdc ft_balance_of a", "usdc ft_balance_of b", "oneup ft_balance_of a"]);
});

test("after a transaction nothing read before it is handed out", async () => {
  let balance = 0;
  const reads = new ReadShare(1000, () => 0);
  const read = () => reads.get("usdc ft_balance_of a", async () => balance);
  assert.equal(await read(), 0);
  balance = 1000; // the faucet ran
  assert.equal(await read(), 0); // inside the hold: still the earlier answer
  reads.clear();
  assert.equal(await read(), 1000);
});

test("a failed read is not kept: the next asker tries again", async () => {
  let fail = true;
  const reads = new ReadShare(1000, () => 0);
  const read = () => reads.get("house get_epoch {}", async () => {
    if (fail) throw new Error("429");
    return 7;
  });
  // everyone waiting on the failed request hears of it
  const both = await Promise.allSettled([read(), read()]);
  assert.deepEqual(both.map((r) => r.status), ["rejected", "rejected"]);
  fail = false;
  assert.equal(await read(), 7);
});

test("old answers are dropped once many questions have been asked", async () => {
  let t = 0;
  const reads = new ReadShare(1000, () => t);
  for (let i = 0; i < 300; i++) await reads.get(`house quote_open ${i}`, async () => i);
  t = 5000;
  let sent = 0;
  await reads.get("house quote_open 300", async () => ++sent);
  // the earlier 300 were cleared out rather than kept for the life of the tab
  assert.equal((reads as unknown as { held: Map<string, unknown> }).held.size, 1);
});
