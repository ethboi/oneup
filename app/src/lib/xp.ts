// XP and levels, the trading screen's game layer. Worked out from an account's closed trades (its history), so
// it's the same on every device and needs no storage. It rewards playing and playing well, never risk: every
// close counts, a win more, a loss too (losing is half the game here: it's how Extra Lives are made), and a
// close by your own take-profit or stop-loss earns a bonus. Leverage earns nothing extra, and nor does a
// liquidation. Three daily quests add more. Levels unlock console shells.

import type { HistoryItem, TradeRecord } from "./server/activity";

/** XP one closed trade earns. */
export function tradeXp(t: Pick<TradeRecord, "pnl" | "reason">): number {
  if (t.reason === "Liquidation") return 10;
  const won = BigInt(t.pnl) > 0n;
  const planned = t.reason === "Target" || t.reason === "Stop";
  return 10 + (won ? 15 : 10) + (planned ? 10 : 0);
}

/** XP needed to reach level `n` (level 1 at 0): 100, 300, 600, 1,000… */
export const xpFor = (n: number) => 50 * (n - 1) * n;

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

export interface Quest {
  id: string;
  name: string;
  n: number;
  of: number;
  xp: number;
}

/** The day's quests (UTC days), from the trades closed that day. */
export function questsOn(items: HistoryItem[], day: number): Quest[] {
  const trades = items.filter((i): i is Extract<HistoryItem, { kind: "trade" }> => i.kind === "trade" && Math.floor(i.trade.closed_t / 86_400_000) === day);
  const wins = trades.filter((i) => BigInt(i.trade.pnl) > 0n).length;
  const planned = trades.filter((i) => i.trade.reason === "Target" || i.trade.reason === "Stop").length;
  const markets = new Set(trades.map((i) => i.trade.market_id)).size;
  return [
    { id: "play", name: "Close 3 trades", n: Math.min(3, trades.length), of: 3, xp: 50 },
    { id: "win", name: "Win a trade", n: Math.min(1, wins), of: 1, xp: 50 },
    { id: "plan", name: "Hit your take-profit or stop-loss", n: Math.min(1, planned), of: 1, xp: 50 },
    { id: "tour", name: "Trade two different markets", n: Math.min(2, markets), of: 2, xp: 50 },
  ];
}

export const today = () => Math.floor(Date.now() / 86_400_000);

/** An account's XP from its history: every close, and every quest done on any day. */
export function historyXp(items: HistoryItem[]): number {
  let xp = 0;
  const days = new Set<number>();
  for (const i of items) {
    if (i.kind !== "trade") continue;
    xp += tradeXp(i.trade);
    days.add(Math.floor(i.trade.closed_t / 86_400_000));
  }
  for (const day of days) for (const q of questsOn(items, day)) if (q.n >= q.of) xp += q.xp;
  return xp;
}
