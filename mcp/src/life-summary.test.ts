import { describe, expect, it } from "vitest";
import type { LifeInfo } from "@oneup/sdk";
import { describeLife } from "./life-summary.ts";

const life = (overrides: Partial<LifeInfo> = {}): LifeInfo => ({
  token_id: "7:alice.test.near", owner_id: "buyer.test.near", epoch: 7,
  face: "10000000", cap_ppm: "2000000", owed: "20000000", paid: "8000000",
  claimable: "3000000", full_heal: false, expired: false, backer: false, ...overrides,
});

describe("MCP Life accounting", () => {
  it("separates cash, allocated and remaining rights after transfer and partial withdrawal", () => {
    const out = describeLife(life(), 9, 3);
    expect(out.owner_id).toBe("buyer.test.near");
    expect(out.usdc_units).toEqual({ maximum_total_payout: "20000000", allocated_lifetime: "8000000", withdrawn_lifetime: "5000000", available_to_claim: "3000000", remaining_conditional_limit: "12000000" });
    expect(out.last_earning_round).toBe(10);
    expect(out.remaining_earning_rounds).toBe(2);
  });
  it("preserves unclaimed cash but removes expired future rights", () => {
    const out = describeLife(life({ expired: true }), 11, 3);
    expect(out.state).toBe("expired");
    expect(out.claimable_usd).toBe(3);
    expect(out.remaining_payout_limit_usd).toBe(0);
    expect(out.remaining_earning_rounds).toBe(0);
  });
  it("does not declare unclaimed allocations withdrawn when a Life reaches its cap", () => {
    const out = describeLife(life({ full_heal: true, paid: "20000000", claimable: "19000000" }), 9, 3);
    expect(out.state).toBe("fully allocated");
    expect(out.withdrawn_usd).toBe(1);
    expect(out.claimable_usd).toBe(19);
    expect(out.remaining_payout_limit_usd).toBe(0);
  });
  it("preserves a final conditional settlement without adding another earning round", () => {
    const out = describeLife(life(), 11, 3);
    expect(out.state).toBe("awaiting settlement");
    expect(out.remaining_earning_rounds).toBe(0);
    expect(out.remaining_payout_limit_usd).toBe(12);
  });
  it("does not expire Backer Lives using the trader earning window", () => {
    const out = describeLife(life({ backer: true, epoch: 0 }), 500, 3);
    expect(out.state).toBe("earning");
    expect(out.last_earning_round).toBeNull();
    expect(out.remaining_earning_rounds).toBeNull();
  });
  it("retains exact amounts beyond JavaScript's safe integer range", () => {
    const out = describeLife(life({ owed: "90071992547409931", paid: "90071992547409929", claimable: "90071992547409928" }), 9, 3);
    expect(out.usdc_units.remaining_conditional_limit).toBe("2");
    expect(out.usdc_units.withdrawn_lifetime).toBe("1");
    expect(out.usdc_units.available_to_claim).toBe("90071992547409928");
  });
});
