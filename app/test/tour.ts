import { test } from "node:test";
import assert from "node:assert/strict";
import { currentStep, tourSteps, type TourState } from "../src/lib/tour.ts";

const none: TourState = { hasAccount: false, openPositions: 0, tradesClosed: 0, lives: 0, claimedOrListed: false, holderOpened: false };

test("the walkthrough starts at getting an account and moves on as the account does each thing", () => {
  assert.equal(currentStep(tourSteps(none, 5))?.id, "account");
  assert.equal(currentStep(tourSteps({ ...none, hasAccount: true }, 5))?.id, "trade");
  // an open trade counts as opening one; closing it is the next step
  assert.equal(currentStep(tourSteps({ ...none, hasAccount: true, openPositions: 1 }, 5))?.id, "close");
  // a trade already closed counts for both
  assert.equal(currentStep(tourSteps({ ...none, hasAccount: true, tradesClosed: 1 }, 5))?.id, "life");
  assert.equal(currentStep(tourSteps({ ...none, hasAccount: true, tradesClosed: 1, lives: 1 }, 5))?.id, "claim");
  assert.equal(currentStep(tourSteps({ ...none, hasAccount: true, tradesClosed: 1, lives: 1, claimedOrListed: true }, 5))?.id, "holder");
  assert.equal(currentStep(tourSteps({ hasAccount: true, openPositions: 0, tradesClosed: 1, lives: 1, claimedOrListed: true, holderOpened: true }, 5)), null);
});

test("the Life step says how often rounds close", () => {
  assert.match(tourSteps(none, 5).find((s) => s.id === "life")!.hint, /every 5 minutes/);
  assert.match(tourSteps(none, 1).find((s) => s.id === "life")!.hint, /every 1 minute\b/);
  assert.match(tourSteps(none, 0).find((s) => s.id === "life")!.hint, /short timer/);
});
