// Achievements: badges worked out from what's on chain (your history, lives and locks) plus moments only
// the app sees (a clutch escape, a tilt, a revenge trade). They're cosmetic: each unlocks nothing but pride
// and, past a few, a colour skin for the console. Nothing here pays, so there's nothing to farm.

import type { LifeInfo, LockInfo } from "@oneup/sdk";
import type { HistoryItem } from "./server/activity";

export interface Achievement {
  id: string;
  name: string;
  how: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "player1", name: "Player 1", how: "Close your first trade" },
  { id: "oneup", name: "1UP", how: "Get your first Extra Life" },
  { id: "payback", name: "Payback", how: "Get paid by an Extra Life: the house pays you back" },
  { id: "fullheal", name: "Full Heal", how: "An Extra Life pays you back in full" },
  { id: "sharpshooter", name: "Sharpshooter", how: "Close at your take-profit" },
  { id: "moon", name: "To the Moon", how: "Make +100% on one trade" },
  { id: "hot3", name: "Hot Streak", how: "Win three trades in a row" },
  { id: "fire5", name: "On Fire", how: "Win five trades in a row" },
  { id: "cold3", name: "Cold Streak", how: "Lose three trades in a row" },
  { id: "bottom5", name: "Rock Bottom", how: "Lose five trades in a row" },
  { id: "clutch", name: "Clutch", how: "Close in profit after nearly being liquidated" },
  { id: "tilted", name: "Tilted", how: "Lose three trades in ten minutes" },
  { id: "revengetrader", name: "Revenge Trader", how: "Open a trade within two minutes of a loss" },
  { id: "trader", name: "Trader", how: "Buy or sell on the market" },
  { id: "diamond", name: "Diamond Hands", how: "Lock $1UP for the full two years" },
  { id: "collector", name: "Collector", how: "Hold five Extra Lives at once" },
];

/** Console skins, each unlocked by a badge (or by a number of badges). */
export interface Skin {
  id: string;
  name: string;
  unlock: { badge: string } | { count: number } | null;
}

export const SKINS: Skin[] = [
  { id: "classic", name: "Classic", unlock: null },
  { id: "berry", name: "Berry", unlock: { badge: "oneup" } },
  { id: "arcade", name: "Arcade", unlock: { badge: "sharpshooter" } },
  { id: "midnight", name: "Midnight", unlock: { count: 6 } },
  { id: "gold", name: "Gold", unlock: { badge: "fullheal" } },
];

export const skinUnlocked = (s: Skin, have: Set<string>) =>
  !s.unlock || ("badge" in s.unlock ? have.has(s.unlock.badge) : have.size >= s.unlock.count);

export function earned(history: HistoryItem[], lives: LifeInfo[], locks: LockInfo[], flags: Set<string>): Set<string> {
  const have = new Set<string>(flags);
  // oldest first, for streaks
  const trades = history.filter((i) => i.kind === "trade").reverse();
  if (trades.length) have.add("player1");
  let wins = 0;
  let losses = 0;
  for (const i of trades) {
    if (i.kind !== "trade") continue;
    const pnl = BigInt(i.trade.pnl);
    if (i.trade.reason === "Target") have.add("sharpshooter");
    if (Number(pnl) >= Number(i.trade.margin)) have.add("moon");
    wins = pnl > 0n ? wins + 1 : 0;
    losses = pnl < 0n ? losses + 1 : 0;
    if (wins >= 3) have.add("hot3");
    if (wins >= 5) have.add("fire5");
    if (losses >= 3) have.add("cold3");
    if (losses >= 5) have.add("bottom5");
  }
  if (lives.length || history.some((i) => i.kind === "life")) have.add("oneup");
  if (history.some((i) => i.kind === "claim_usdc")) have.add("payback");
  if (lives.some((l) => l.full_heal)) have.add("fullheal");
  if (lives.filter((l) => !l.expired && !l.full_heal).length >= 5) have.add("collector");
  if (history.some((i) => i.kind === "bought" || i.kind === "sold")) have.add("trader");
  if (locks.some((l) => !l.from_loss && l.end - l.created >= 103)) have.add("diamond");
  return have;
}

// Moments only the app sees, remembered per account in this browser.

const flagKey = (account: string) => `oneup.flags.${account}`;

export function readFlags(account: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(flagKey(account)) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function addFlag(account: string, id: string) {
  const f = readFlags(account);
  if (f.has(id)) return;
  f.add(id);
  try {
    localStorage.setItem(flagKey(account), JSON.stringify([...f]));
  } catch {}
  window.dispatchEvent(new Event("oneup-flags"));
}

/** Positions that were near liquidation at some point (for Clutch). */
export const nearMisses = new Set<number>();
