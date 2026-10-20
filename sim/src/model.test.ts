// Pins the simulation's findings (docs/decisions.md D-13) so a model change that flips them is noticed.
import { describe, expect, it } from "vitest";
import { flows, run, windowedByQuarter } from "./model.ts";

const params = { epochs: 208, start: 20_000, peak: 2_000_000, mid: 52, edge: 0.15, seed: 1 };

describe("early vs late", () => {
  const r = run(flows(params));
  const q = (c: typeof r.oneup) => windowedByQuarter(c, 156, 52);

  it("without expiry, late losers recover far less than early ones", () => {
    const [first, , , last] = q(r.oneupNoExpiry);
    expect(first / last).toBeGreaterThan(2.5);
  });

  it("with lives expiring after 13 epochs, recovery is close to flat", () => {
    const [first, , , last] = q(r.oneup);
    expect(first / last).toBeLessThan(1.6);
    expect(last).toBeGreaterThan(q(r.oneupNoExpiry)[3]);
  });

  it("no money is created: lives never get back more than 2× what the house kept", () => {
    const kept = flows(params).reduce((s, f) => s + Math.max(0, f.losses - f.payouts), 0);
    const paid = r.oneup.reduce((s, c) => s + c.recovered, 0);
    expect(paid).toBeLessThanOrEqual(2 * kept);
  });
});
