import { expect, it } from "vitest";
import { profitRelease } from "./farm.ts";

it("losing epochs release zero without inventing carry or negative farmer tokens", () => {
  const state = { carry: 123 };
  const rules = profitRelease(20);
  expect(rules.farmerOneup(1000, -100, 100, state)).toBe(0);
  expect(state.carry).toBeCloseTo(123 + 900_000_000 / 208);
  const available = state.carry + 900_000_000 / 208;
  expect(rules.farmerOneup(1000, 100, 100, state)).toBeCloseTo(2200 * 10 / 1010);
  expect(state.carry).toBeCloseTo(available - 2200);
});
