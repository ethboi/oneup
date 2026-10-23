import { expect, it } from "vitest";
import { bootstrap, sensitivity, farmingScenarios } from "./sensitivity.ts";
import { oneup } from "./model.ts";
it("uses deployment backer claim amounts and reconciles caps including expired claims", () => {
  expect(bootstrap(250000, [60000, 40000])).toEqual({pool: 350000, owed: 426000});
  expect(bootstrap(900000, [200000])).toEqual({pool: 1100000, owed: 1144000});
  const r = oneup(Array.from({length: 30}, () => ({losses: 100, payouts: 0})), 1000, .9, 13);
  const paid = r.cohorts.reduce((sum, c) => sum + c.recovered, 0);
  expect(paid + r.outstandingCaps + r.expiredUnpaid).toBeCloseTo(r.mintedCaps);
  expect(r.expiredUnpaid).toBeGreaterThan(0);
});
it("reports unfavorable regimes and keeps separate-wallet farming distinct", () => {
  const results = sensitivity(3);
  expect(results.find(r => r.assumptions.name === "Negative house edge")!.cashDeficit.max).toBeGreaterThan(0);
  expect(results.find(r => r.assumptions.name === "High utilisation")!.expiredUnpaidCaps.median).toBeGreaterThan(0);
  expect(results).toEqual(sensitivity(3));
  const farm = farmingScenarios();
  expect(farm[4].breakEvenFdv).toBeLessThan(farm[1].breakEvenFdv);
});
