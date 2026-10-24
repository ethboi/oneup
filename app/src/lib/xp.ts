// XP and levels, the trading screen's game layer. Worked out from an account's closed trades (its history), so
// it's the same on every device and needs no storage: every trade counts, a win more, a loss too (losing is
// half the game here: it's how Extra Lives are made), and leverage adds a bonus. Levels unlock console shells.

import type { HistoryItem } from "./server/activity";

/** XP one closed trade earns. */
export function tradeXp(t: { pnl: string; leverage: number; reason: string }): number {
  const won = BigInt(t.pnl) > 0n;
  // 10 for playing, 15 more for a win or 10 for a loss (a loss brings an Extra Life), and 5 per order of
  // magnitude of leverage: 10× +5, 100× +10, 1000× +15
  const lev = Math.floor(Math.log10(Math.max(1, t.leverage))) * 5;
  const rekt = t.reason === "Liquidation" ? 5 : 0;
  return 10 + (won ? 15 : 10) + lev + rekt;
}

/** XP needed to reach level `n` (level 1 at 0): 100, 300, 600, 1,000… */
export const xpFor = (n: number) => (50 * (n - 1) * n);

export interface Level {
  level: number;
  xp: number;
  /** XP into this level, and the size of the level. */
  into: number;
  span: number;
}

export function levelOf(xp: number): Level {
  let n = 1;
  while (xp >= xpFor(n + 1)) n++;
  return { level: n, xp, into: xp - xpFor(n), span: xpFor(n + 1) - xpFor(n) };
}

/** An account's XP from its history (newest first, as /api/history returns it). */
export function historyXp(items: HistoryItem[]): number {
  return items.reduce((s, i) => (i.kind === "trade" ? s + tradeXp(i.trade) : s), 0);
}
