import { test } from "node:test";
import assert from "node:assert/strict";
import type { LifeInfo } from "@oneup/sdk";
import { lifeEconomics, lifeEarningLabel } from "../src/lib/life-economics.ts";

const life = (overrides: Partial<LifeInfo> = {}): LifeInfo => ({
  token_id: "7:alice", owner_id: "alice.test.near", epoch: 7, face: "10000000", cap_ppm: "2000000",
  owed: "20000000", paid: "0", claimable: "0", full_heal: false, expired: false, backer: false,
  ...overrides,
});

test("fresh Life exposes a conditional cap separately from spendable funds and uses configured expiry", () => {
  const e = lifeEconomics(life(), 7, 3);
  assert.equal(e.claimable, 0n);
  assert.equal(e.additionalCap, 20_000_000n);
  assert.equal(e.lastEarningEpoch, 10);
  assert.equal(e.remainingEarningRounds, 4);
  assert.equal(e.status, "earning");
  assert.equal(lifeEarningLabel(life(), 10, 3), "1 earning round remaining, including the current round · through round 10");
});

test("allocations and claims never get double counted as additional future cap", () => {
  const accrued = lifeEconomics(life({ paid: "8000000", claimable: "8000000" }), 8, 3);
  assert.equal(accrued.claimable, 8_000_000n);
  assert.equal(accrued.additionalCap, 12_000_000n);
  assert.equal(accrued.allocated, 8_000_000n);
  assert.equal(accrued.withdrawn, 0n);
  const claimed = lifeEconomics(life({ paid: "8000000", claimable: "3000000" }), 8, 3);
  assert.equal(claimed.additionalCap, 12_000_000n);
  assert.equal(claimed.claimable, 3_000_000n);
  assert.equal(claimed.withdrawn, 5_000_000n);
});

test("expired Life remains claimable and sellable when allocated funds remain", () => {
  const e = lifeEconomics(life({ expired: true, paid: "8000000", claimable: "3000000" }), 12, 3);
  assert.equal(e.additionalCap, 0n);
  assert.equal(e.claimable, 3_000_000n);
  assert.equal(e.remainingEarningRounds, 0);
  assert.equal(e.status, "expired");
  assert.equal(e.hasRecoverableFunds, true);
  assert.equal(lifeEconomics(life({ expired: true, paid: "8000000" }), 12, 3).hasRecoverableFunds, false);
});

test("fully allocated Life distinguishes unclaimed funds from withdrawn allocations", () => {
  const e = lifeEconomics(life({ full_heal: true, paid: "20000000", claimable: "9000000" }), 8, 3);
  assert.equal(e.additionalCap, 0n);
  assert.equal(e.claimable, 9_000_000n);
  assert.equal(e.withdrawn, 11_000_000n);
  assert.equal(e.remainingEarningRounds, 0);
  assert.equal(e.status, "fully-allocated");
  assert.equal(e.hasRecoverableFunds, true);
});

test("Backer Lives have no expiry even after the usual loss-Life earning window", () => {
  const e = lifeEconomics(life({ backer: true, epoch: 0 }), 100, 3);
  assert.equal(e.lastEarningEpoch, null);
  assert.equal(e.remainingEarningRounds, null);
  assert.equal(e.additionalCap, 20_000_000n);
  assert.equal(lifeEarningLabel(life({ backer: true }), 100, 3), "No expiry · future payouts depend on house profit");
});

test("missing parameters do not assume a fourteen-round earning window", () => {
  assert.equal(lifeEconomics(life(), 9).remainingEarningRounds, null);
  assert.equal(lifeEconomics(life(), undefined, 3).remainingEarningRounds, null);
  assert.equal(lifeEarningLabel(life(), 9), "Loading earning window…");
});

test("round boundary preserves a possibly pending final settlement without inventing another earning round", () => {
  const e = lifeEconomics(life(), 11, 3);
  assert.equal(e.remainingEarningRounds, 0);
  assert.equal(e.status, "awaiting-settlement");
  assert.equal(e.additionalCap, 20_000_000n);
  assert.equal(lifeEarningLabel(life(), 11, 3), "No earning rounds remain · final settlement may be pending");
});
