import { test } from "node:test";
import assert from "node:assert/strict";
import { currentStep, tourSteps, watchStart, watchTrading, type TourState } from "../src/lib/tour.ts";

const none: TourState = { hasAccount: false, traded: false, tradeEnded: false, lives: 0, claimedOrListed: false, holderOpened: false };

test("the walkthrough starts at getting an account and moves on as the account does each thing", () => {
  assert.equal(currentStep(tourSteps(none, 5))?.id, "account");
  assert.equal(currentStep(tourSteps({ ...none, hasAccount: true }, 5))?.id, "trade");
  // an order sent or a trade open counts as opening one; its end is the next step
  assert.equal(currentStep(tourSteps({ ...none, hasAccount: true, traded: true }, 5))?.id, "close");
  // a trade that has ended counts for both
  assert.equal(currentStep(tourSteps({ ...none, hasAccount: true, tradeEnded: true }, 5))?.id, "life");
  assert.equal(currentStep(tourSteps({ ...none, hasAccount: true, tradeEnded: true, lives: 1 }, 5))?.id, "claim");
  assert.equal(currentStep(tourSteps({ ...none, hasAccount: true, tradeEnded: true, lives: 1, claimedOrListed: true }, 5))?.id, "holder");
  assert.equal(currentStep(tourSteps({ hasAccount: true, traded: true, tradeEnded: true, lives: 1, claimedOrListed: true, holderOpened: true }, 5)), null);
});

test("the trade steps tick from what the visit watched, without waiting for the history", () => {
  const quiet = { positions: 0, orders: 0, roundLoss: false };
  let w = watchStart("a.testnet");
  assert.equal(watchTrading(w, "a.testnet", quiet), w, "nothing seen, nothing changes");
  // the order waits for the keeper
  w = watchTrading(w, "a.testnet", { ...quiet, orders: 1 });
  assert.deepEqual([w.traded, w.ended], [true, false]);
  // filled, then gone: closed or liquidated
  w = watchTrading(w, "a.testnet", { ...quiet, positions: 1 });
  assert.deepEqual([w.traded, w.ended], [true, false]);
  w = watchTrading(w, "a.testnet", quiet);
  assert.deepEqual([w.traded, w.ended], [true, true]);
  // it stays ended while the next trade is open
  assert.equal(watchTrading(w, "a.testnet", { ...quiet, positions: 1 }).ended, true);

  // opened and liquidated between two looks: the round's loss is all there is to see
  const fast = watchTrading(watchStart("a.testnet"), "a.testnet", { ...quiet, roundLoss: true });
  assert.deepEqual([fast.traded, fast.ended], [true, true]);

  // one of two positions closing is a trade ended
  const two = watchTrading(watchStart("a.testnet"), "a.testnet", { ...quiet, positions: 2 });
  assert.equal(watchTrading(two, "a.testnet", { ...quiet, positions: 1 }).ended, true);

  // another account starts clean, and the first one's open position isn't its close
  const other = watchTrading(two, "b.testnet", quiet);
  assert.deepEqual(other, watchStart("b.testnet"));
});

test("the Life step says how often rounds close", () => {
  assert.match(tourSteps(none, 5).find((s) => s.id === "life")!.hint, /every 5 minutes/);
  assert.match(tourSteps(none, 1).find((s) => s.id === "life")!.hint, /every 1 minute\b/);
  assert.match(tourSteps(none, 0).find((s) => s.id === "life")!.hint, /short timer/);
});

test("each step has a line short enough for a phone's strip", () => {
  for (const s of tourSteps(none, 10)) {
    assert.ok(s.short.length > 0 && s.short.length <= 90, `${s.id}: ${s.short.length}`);
    assert.ok(s.short.length < s.hint.length, s.id);
  }
});

test("the first step offers a guest account only where the site hands them out", () => {
  const withGuests = tourSteps(none, 5)[0];
  assert.match(withGuests.hint, /guest/);
  assert.match(withGuests.short, /guest/);
  const without = tourSteps(none, 5, false)[0];
  assert.doesNotMatch(without.hint, /guest/);
  assert.doesNotMatch(without.short, /guest/);
  assert.match(without.short, /testnet wallet/);
});
