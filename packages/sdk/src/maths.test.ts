// The same vectors as contracts/math (docs/maths.md V1–V7): the app's previews must match the chain.
import { describe, expect, it } from "vitest";
import * as m from "./maths.ts";

const usd = (x: number) => BigInt(x) * m.USDC;
const px = (cents: number) => BigInt(cents) * 1_000_000n;

describe("maths vectors", () => {
  it("V1 Life NFT sizing", () => {
    const face = m.faceValue(usd(100_000), usd(3_000), usd(300_000));
    expect(face).toBe(usd(1_000));
    expect(m.lifeCapPpm(usd(200_000))).toBe(1_840_000n);
    expect(m.owed(face, 1_840_000n)).toBe(usd(1_840));
  });

  it("fees can't make a Life worth more than its loss", () => {
    expect(m.faceValue(usd(1_001), usd(1), usd(1))).toBe(usd(1));
    expect(m.faceValue(usd(5_000), usd(300), usd(400))).toBe(usd(300));
    expect(m.recoveryBase(usd(100_000), usd(300_000))).toBe(usd(100_000));
    const quiet = { id: 1, losses: String(usd(1)), payouts: "0", net_losses: String(usd(1)), fees: String(usd(1_000)) };
    expect(m.previewLossEmission(quiet, 0n, usd(1), 20n)).toBe(20n * m.ONEUP);
  });

  it("a losing round is a loss, not zero", () => {
    // winners were paid more than losers and fees brought in
    const losing = { losses: String(usd(400)), payouts: String(usd(500)), fees: String(usd(17)) };
    expect(m.houseResult(losing)).toBe(-usd(83));
    expect(m.houseResult({ losses: String(usd(500)), payouts: String(usd(400)), fees: String(usd(17)) })).toBe(usd(117));
    expect(m.houseResult({ losses: String(usd(5)), payouts: "0" })).toBe(usd(5));
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
    expect(m.vePower(1_000n * m.ONEUP, 52n)).toBe(500n * m.ONEUP);
    expect(m.exitPenalty(1_000n * m.ONEUP, 104n)).toBe(500n * m.ONEUP);
    expect(m.exitPenalty(1n, 1n)).toBe(1n);
    expect(m.releasedEmissions(m.emissionsForEpoch(1n), 1_000n * m.USDC)).toBe(20_000n * m.ONEUP);
  });

  it("formats", () => {
    expect(m.fmtUsdc(1_234_567_890n)).toBe("1,234.56");
    expect(m.fmtUsdc(-500_000n)).toBe("-0.50");
  });
});


it("loser previews use wallet net losses, market fees up to those losses, and the configured rate", () => {
  const epoch = { id: 1, losses: usd(200).toString(), payouts: usd(90).toString(), net_losses: usd(110).toString(), fees: "0" };
  expect(m.previewLossEmission(epoch, 0n, usd(10))).toBe(200n * m.ONEUP);
  expect(m.previewLossEmission(epoch, 0n, usd(100))).toBe(2000n * m.ONEUP);
  // fees count as house profit: 200 + 5 − 100 = 105 of the 110 net losses
  expect(m.previewLossEmission({ ...epoch, payouts: usd(100).toString(), fees: usd(5).toString() }, 0n, usd(11), 10n)).toBe(105n * m.ONEUP);
  // but never past the net losses: 200 + 11 − 90 = 121 is sized as 110
  expect(m.previewLossEmission({ ...epoch, fees: usd(11).toString() }, 0n, usd(10), 10n)).toBe(100n * m.ONEUP);
  expect(m.releasedEmissions(100n * m.ONEUP, -usd(1))).toBe(0n);
});


it("form amounts are exact, finite, nonnegative and bounded to u128", () => {
  expect(m.parseTokenAmount("1.000001", 6)).toBe(1000001n);
  expect(m.parseTokenAmount("0.000000000000000001", 18)).toBe(1n);
  expect(m.parseTokenAmount(".5", 6)).toBe(500000n);
  for (const text of ["Infinity", "1e999", "NaN", "-1", "0.0000001", "9".repeat(80)]) expect(m.parseTokenAmount(text, 6)).toBe(0n);
  expect(m.numberToPrice(Infinity)).toBe(0n);
});

it("history, share cards and rankings use the profit actually retained after the winner cut", () => {
  expect(m.netTradePnl({ pnl: "55000000", cut: "5544000" })).toBe(49456000n);
  expect(m.netTradePnl({ pnl: "-500000000", cut: "0" })).toBe(-500000000n);
  expect(m.netTradePnl({ pnl: "-100" })).toBe(-100n);
});
