import { test } from "node:test";
import assert from "node:assert/strict";
import type { LifeInfo } from "@oneup/sdk";
import { groupLives, lifeClaimBatch, lifeFromHash, lifeHref, recoveryStep } from "../src/lib/recovery-journey.ts";

const life = (patch: Partial<LifeInfo> = {}): LifeInfo => ({ token_id: "3:alice.test.near", owner_id: "alice.test.near", epoch: 3, face: "1000000", cap_ppm: "2000000", owed: "2000000", paid: "0", claimable: "0", expired: false, full_heal: false, backer: false, ...patch });

test("finished NFTs with unclaimed USDC stay in the prominent claim group, exactly once", () => {
  const expired = life({ token_id: "expired", expired: true, paid: "500000", claimable: "250000" });
  const healed = life({ token_id: "healed", full_heal: true, paid: "2000000", claimable: "1000000" });
  const empty = life({ token_id: "empty", expired: true, paid: "200000", claimable: "0" });
  const earning = life({ token_id: "earning" });
  const input = [expired, earning, healed, empty];
  const groups = groupLives(input);
  assert.deepEqual(groups.claimable.map(l => l.token_id), ["healed", "expired"]);
  assert.deepEqual(groups.earning.map(l => l.token_id), ["earning"]);
  assert.deepEqual(groups.finished.map(l => l.token_id), ["empty"]);
  assert.equal(new Set(Object.values(groups).flat().map(l => l.token_id)).size, input.length);
  assert.equal(input[0], expired, "grouping must not mutate a polled snapshot");
});

test("guide prioritizes an actual claim over earning rights or a new unsettled loss", () => {
  const claimable = life({ token_id: "expired", expired: true, paid: "500000", claimable: "500000" });
  const next = recoveryStep([life(), claimable], "9000000");
  assert.equal(next.phase, "claim");
  assert.equal(next.claimable, 500000n);
  assert.equal(next.tokenId, "expired");
  assert.equal(next.count, 1);
});

test("guide refreshes its next step as funds are claimed and ownership changes", () => {
  const owned = life({ paid: "500000", claimable: "500000" });
  assert.equal(recoveryStep([owned], "0").phase, "claim");
  assert.equal(recoveryStep([{ ...owned, claimable: "0" }], "0").phase, "earning");
  assert.equal(recoveryStep([], "0").phase, "empty", "a transferred NFT must not remain the former wallet's next action");
  assert.equal(recoveryStep([], "1000000").phase, "pending");
  assert.equal(recoveryStep([life({ expired: true })], "0").phase, "finished");
  assert.equal(recoveryStep(undefined, "0").phase, "loading", "account changes do not briefly show an empty wallet");
  assert.equal(recoveryStep([], undefined).phase, "loading");
});

test("Life detail links preserve opaque token IDs and ignore malformed or unrelated hashes", () => {
  const id = "7:alice%25.test.near/part#1";
  assert.equal(lifeFromHash(new URL(lifeHref(id), "http://localhost").hash), id);
  assert.equal(lifeFromHash("#fairness"), null);
  assert.equal(lifeFromHash("#life="), null);
  assert.equal(lifeFromHash("#life=%E0%A4%A"), null);
});


test("claim summary covers only the next 30 NFTs and keeps finished unclaimed funds eligible", () => {
  const lives = Array.from({ length: 31 }, (_, i) => life({ token_id: `life-${i + 1}`, claimable: String(i + 1), paid: String(i + 1), expired: i === 30 }));
  const batch = lifeClaimBatch(lives);
  assert.equal(batch.tokenIds.length, 30);
  assert.equal(batch.amount, 495n);
  assert.equal(batch.remainingCount, 1);
  assert.equal(batch.tokenIds[0], "life-31", "the expired NFT with the largest unclaimed amount is included");
  const after = lives.map(l => batch.tokenIds.includes(l.token_id) ? { ...l, claimable: "0" } : l);
  assert.deepEqual(lifeClaimBatch(after), { tokenIds: ["life-1"], amount: 1n, remainingCount: 0 });
  assert.deepEqual(lifeClaimBatch([]), { tokenIds: [], amount: 0n, remainingCount: 0 });
});
