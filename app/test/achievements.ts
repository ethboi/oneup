import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeStates } from "../src/lib/achievements.ts";
import type { HistoryItem, TradeRecord } from "../src/lib/server/activity.ts";

const usd = (x: number) => String(Math.round(x * 1e6));
let seq = 0;
/** A close at minute `m`, newest-first like the history. */
const close = (m: number, pnl: number, over: Partial<TradeRecord> = {}): HistoryItem => ({
  seq: ++seq,
  t: m * 60_000,
  kind: "trade",
  trade: {
    position_id: seq,
    market_id: "NEAR-USD",
    side: "Long",
    leverage: 10,
    margin: usd(100),
    entry_price: "500000000",
    exit_price: "500000000",
    pnl: usd(pnl),
    reason: "Close",
    opened_t: (m - 5) * 60_000,
    closed_t: m * 60_000,
    ...over,
  },
});
const states = (items: HistoryItem[]) => badgeStates([...items].reverse(), [], [], new Set());

test("a liquidation is Rekt, dated, and counts toward Serial Rekt", () => {
  const s = states([close(1, -100, { reason: "Liquidation" }), close(2, 10)]);
  assert.deepEqual(s.get("rekt"), { got: true, at: 60_000 });
  assert.deepEqual(s.get("serialrekt"), { got: false, progress: { n: 1, of: 5 } });
});

test("the 9× cap is Max Win; a win right after five losses is Comeback Kid", () => {
  const s = states([...[1, 2, 3, 4, 5].map((m) => close(m, -10)), close(6, 900, { reason: "TakeProfit" })]);
  assert.equal(s.get("maxwin")?.got, true);
  assert.equal(s.get("comeback")?.got, true);
  assert.equal(s.get("bottom5")?.got, true);
  assert.deepEqual(s.get("hot3")?.progress, { n: 1, of: 3 });
});

test("counts show progress until they're earned", () => {
  const s = states(Array.from({ length: 30 }, (_, i) => close(i + 1, 1, { market_id: i % 2 ? "BTC-USD" : "NEAR-USD" })));
  assert.equal(s.get("regular")?.got, true);
  assert.deepEqual(s.get("centurion"), { got: false, progress: { n: 30, of: 100 } });
  assert.deepEqual(s.get("globetrotter"), { got: false, progress: { n: 2, of: 3 } });
});

test("every badge has a sprite, every sprite row is the same width and uses its palette", async () => {
  const { ACHIEVEMENTS } = await import("../src/lib/achievements.ts");
  const { SPRITES } = await import("../src/lib/sprites.ts");
  for (const a of ACHIEVEMENTS) {
    const s = SPRITES[a.id];
    assert.ok(s, `${a.id} has no sprite`);
    const w = s.rows[0].length;
    for (const r of s.rows) {
      assert.equal(r.length, w, `${a.id}: "${r}" is not ${w} wide`);
      for (const c of r) if (c !== ".") assert.ok(c in s.colors, `${a.id}: no colour for "${c}"`);
    }
  }
});
