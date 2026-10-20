// The same vectors as contracts/math (docs/maths.md V1–V7): the app's previews must match the chain.
import { describe, expect, it } from "vitest";
import * as m from "./maths.ts";

const usd = (x: number) => BigInt(x) * m.USDC;
const px = (cents: number) => BigInt(cents) * 1_000_000n;

describe("maths vectors", () => {
  it("V1 Extra Life sizing", () => {
    const face = m.faceValue(usd(100_000), usd(3_000), usd(300_000));
    expect(face).toBe(usd(1_000));
    expect(m.lifeCapPpm(usd(200_000))).toBe(1_840_000n);
    expect(m.owed(face, 1_840_000n)).toBe(usd(1_840));
  });

  it("V2 pnl and liquidation", () => {
    expect(m.pnl("Long", usd(1_000), 50, px(500), px(540))).toBe(usd(4_000));
    expect(m.pnl("Long", usd(1_000), 50, px(500), px(600))).toBe(usd(9_000));
    expect(m.pnl("Short", usd(1_000), 50, px(500), px(600))).toBe(-usd(1_000));
    expect(m.liquidationPrice("Long", px(500), 50)).toBe(px(491));
    expect(m.liquidationPrice("Short", px(500), 50)).toBe(px(509));
    expect(m.isLiquidatable(m.pnl("Long", usd(1_000), 50, px(500), px(491)), usd(1_000))).toBe(true);
    // losses round against the trader, like the contract
    expect(m.pnl("Long", 3n, 1, 7n, 6n)).toBe(-1n);
  });

  it("V3 winner's cut", () => {
    const cut = m.cutPpm(m.maxLiability(usd(1_000)), usd(100_000));
    expect(cut).toBe(145_000n);
    const s = m.settle(usd(1_000), usd(5_000), cut);
    expect([s.cut, s.toTrader, s.poolPaid]).toEqual([usd(725), usd(5_275), usd(4_275)]);
    expect(m.cutPpm(m.maxLiability(usd(4_000)), usd(100_000))).toBe(m.CUT_MAX_PPM);
  });

  it("V4 solvency rules", () => {
    const long = m.maxLiability(usd(2_300));
    const short = m.maxLiability(usd(500));
    expect(m.marketLiability(long, short) > usd(25_000)).toBe(true);
    expect(m.marketLiability(long, short, false)).toBe(usd(20_700));
  });

  it("V5 epoch payout", () => {
    const p = m.epochPayout(usd(200_000), usd(50_000), usd(36_840));
    expect([p.reserve, p.surplus, p.livesPot, p.buybackPot]).toEqual([usd(60_000), usd(140_000), usd(36_840), usd(26_160)]);
  });

  it("V6 emissions", () => {
    expect(m.emissionsForEpoch(1n)).toBe(4_326_923_076_923_076_923_076_923n);
    let total = 0n;
    for (let e = 1n; e <= 208n; e++) total += m.emissionsForEpoch(e);
    expect(total).toBe(m.EMISSIONS_TOTAL);
  });

  it("V7 ve power", () => {
    expect(m.vePower(1_000n * m.ONEUP, 26n)).toBe(500n * m.ONEUP);
  });

  it("formats", () => {
    expect(m.fmtUsdc(1_234_567_890n)).toBe("1,234.56");
    expect(m.fmtUsdc(-500_000n)).toBe("-0.50");
  });
});
