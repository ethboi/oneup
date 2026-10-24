// Achievements: badges worked out from what's on chain (your history, lives and locks) plus moments only
// the app sees (a clutch escape, a tilt, a revenge trade). They're cosmetic: each unlocks nothing but pride
// and, past a few, a colour skin for the console. Nothing here pays, so there's nothing to farm.

import type { LifeInfo, LockInfo } from "@oneup/sdk";
import type { HistoryItem } from "./server/activity";

export type Rarity = "common" | "rare" | "epic" | "legendary";
export type Group = "Trading" | "Streaks" | "Losses" | "Lives & locks";

export interface Achievement {
  id: string;
  name: string;
  /** What earns it, in one line. */
  how: string;
  /** A sentence more: why it matters or what it says about you. */
  detail: string;
  group: Group;
  rarity: Rarity;
}

export const GROUPS: Group[] = ["Trading", "Streaks", "Losses", "Lives & locks"];

export const ACHIEVEMENTS: Achievement[] = [
  // Trading
  { id: "player1", name: "Player 1", how: "Close your first trade", detail: "Everyone starts somewhere. Win or lose, you're in the game.", group: "Trading", rarity: "common" },
  { id: "regular", name: "Regular", how: "Close 25 trades", detail: "The house knows your name by now.", group: "Trading", rarity: "rare" },
  { id: "centurion", name: "Centurion", how: "Close 100 trades", detail: "A hundred trades against the house. Few get this far.", group: "Trading", rarity: "epic" },
  { id: "globetrotter", name: "Globetrotter", how: "Trade every market", detail: "NEAR, BTC and ETH: you've had a go at all of them.", group: "Trading", rarity: "common" },
  { id: "switch", name: "Switch Hitter", how: "Win a long and a short", detail: "Up or down, you can call both directions.", group: "Trading", rarity: "common" },
  { id: "sharpshooter", name: "Sharpshooter", how: "Close a trade using take-profit", detail: "Your take-profit trigger closed a trade. Unlocks the Arcade skin.", group: "Trading", rarity: "common" },
  { id: "stopped", name: "Stopped Out", how: "Close at your stop-loss", detail: "A small loss you chose beats a big one you didn't.", group: "Trading", rarity: "common" },
  { id: "paperhands", name: "Paper Hands", how: "Take a profit within two minutes of opening", detail: "Quick in, quick out. A win is a win.", group: "Trading", rarity: "common" },
  { id: "hodl", name: "HODL", how: "Hold a trade for 30 minutes", detail: "Patience, while everyone else flips every minute.", group: "Trading", rarity: "common" },
  { id: "degen", name: "Degen", how: "Trade at 100× leverage", detail: "A 0.9% move against you and it's gone. You did it anyway.", group: "Trading", rarity: "rare" },
  { id: "whale", name: "Whale", how: "Trade with $10,000 or more of margin", detail: "Big money on one trade. The house had to make room.", group: "Trading", rarity: "rare" },
  { id: "moon", name: "To the Moon", how: "Make +100% on one trade", detail: "Doubled your margin in one go.", group: "Trading", rarity: "rare" },
  { id: "bigwin", name: "Big Win", how: "Make $1,000 or more on one trade", detail: "Four figures from one trade, and a shower of coins.", group: "Trading", rarity: "rare" },
  { id: "maxwin", name: "Max Win", how: "Hit the 9× profit cap", detail: "The maximum profit before fees is nine times the trade’s margin.", group: "Trading", rarity: "legendary" },
  // Streaks
  { id: "hot3", name: "Hot Streak", how: "Win three trades in a row", detail: "Three for three. Don't look down.", group: "Streaks", rarity: "common" },
  { id: "fire5", name: "On Fire", how: "Win five trades in a row", detail: "Five straight wins. The house is sweating.", group: "Streaks", rarity: "rare" },
  { id: "cold3", name: "Cold Streak", how: "Lose three trades in a row", detail: "Three consecutive losses. Extra Life eligibility depends on your net result and house profit for the round.", group: "Streaks", rarity: "common" },
  { id: "bottom5", name: "Rock Bottom", how: "Lose five trades in a row", detail: "Five consecutive losses.", group: "Streaks", rarity: "rare" },
  { id: "comeback", name: "Comeback Kid", how: "Win right after losing five in a row", detail: "From Rock Bottom straight to a win.", group: "Streaks", rarity: "epic" },
  // Losses
  { id: "rekt", name: "Rekt", how: "Get liquidated", detail: "Your position reached its liquidation threshold and the full margin went to the pool. Recovery NFT eligibility is decided at round end.", group: "Losses", rarity: "common" },
  { id: "serialrekt", name: "Serial Rekt", how: "Get liquidated five times", detail: "At this point the liquidation line knows you personally.", group: "Losses", rarity: "rare" },
  { id: "ouch", name: "Ouch", how: "Lose $1,000 or more on one trade", detail: "A loss of at least $1,000 on one trade. A recovery NFT is not guaranteed.", group: "Losses", rarity: "rare" },
  { id: "tilted", name: "Tilted", how: "Lose three trades in ten minutes", detail: "The TILT light came on. Maybe take a breather.", group: "Losses", rarity: "common" },
  { id: "revengetrader", name: "Back to Market", how: "Opened a trade within two minutes of a loss", detail: "Opened another position soon after a loss. Review risk before placing a new trade.", group: "Losses", rarity: "common" },
  { id: "clutch", name: "Clutch", how: "Close in profit after nearly being liquidated", detail: "Inches from liquidation, and you still came out ahead.", group: "Losses", rarity: "epic" },
  // Lives & locks
  { id: "oneup", name: "1UP", how: "Get your first Extra Life", detail: "You received your first Extra Life, with rights to eligible house-profit payouts. Unlocks the Berry skin.", group: "Lives & locks", rarity: "common" },
  { id: "collector", name: "Collector", how: "Hold five Extra Lives at once", detail: "You hold five active Extra Lives. Their payouts depend on house profit.", group: "Lives & locks", rarity: "rare" },
  { id: "payback", name: "Payback", how: "Claim USDC from an Extra Life", detail: "You claimed USDC allocated to an Extra Life.", group: "Lives & locks", rarity: "rare" },
  { id: "fullheal", name: "Full Heal", how: "An Extra Life reaches its payout limit", detail: "An Extra Life received its maximum payout. Unlocks the Gold skin.", group: "Lives & locks", rarity: "legendary" },
  { id: "diamond", name: "Diamond Hands", how: "Lock $1UP for 104 rounds", detail: "For the same amount of $1UP, a longer lock gives more reward weight.", group: "Lives & locks", rarity: "epic" },
  { id: "trader", name: "Trader", how: "Buy or sell on the market", detail: "Extra Lives and locks are NFTs: you've traded one.", group: "Lives & locks", rarity: "common" },
  { id: "exit", name: "Exit Liquidity", how: "Sell an Extra Life", detail: "Took the cash now instead of waiting for the house's profit.", group: "Lives & locks", rarity: "common" },
  { id: "backer", name: "Backer", how: "Back the house", detail: "You contributed USDC to the pool and received a Backer Life.", group: "Lives & locks", rarity: "rare" },
];

/** Console skins: Game Boy Color shells (unlocked by level) and the original mono screens (by badges). */
export interface Skin {
  id: string;
  name: string;
  unlock: { badge: string } | { count: number } | { level: number } | null;
}

export const SKINS: Skin[] = [
  { id: "atomic", name: "Atomic Purple", unlock: null },
  { id: "classic", name: "Classic (mono)", unlock: null },
  { id: "kiwi", name: "Kiwi", unlock: { level: 2 } },
  { id: "teal", name: "Teal", unlock: { level: 3 } },
  { id: "dandelion", name: "Dandelion", unlock: { level: 4 } },
  { id: "grape", name: "Grape", unlock: { level: 5 } },
  { id: "berry", name: "Berry", unlock: { badge: "oneup" } },
  { id: "arcade", name: "Arcade", unlock: { badge: "sharpshooter" } },
  { id: "midnight", name: "Midnight", unlock: { count: 10 } },
  { id: "gold", name: "Gold", unlock: { badge: "fullheal" } },
];

export const skinUnlocked = (s: Skin, have: Set<string>, level = 1) =>
  !s.unlock || ("badge" in s.unlock ? have.has(s.unlock.badge) : "level" in s.unlock ? level >= s.unlock.level : have.size >= s.unlock.count);

/** What unlocks a skin, in words. */
export const skinNeed = (s: Skin) =>
  !s.unlock ? "" : "badge" in s.unlock ? ACHIEVEMENTS.find((a) => a.id === (s.unlock as { badge: string }).badge)!.name : "level" in s.unlock ? `Level ${s.unlock.level}` : `${s.unlock.count} badges`;

/** One badge for one account: whether it's earned, when (if known), and progress toward it if it counts. */
export interface BadgeState {
  got: boolean;
  /** When it was earned (ms), for badges read from history. */
  at?: number;
  progress?: { n: number; of: number };
}

export function badgeStates(history: HistoryItem[], lives: LifeInfo[], locks: LockInfo[], flags: Set<string>): Map<string, BadgeState> {
  const out = new Map<string, BadgeState>(ACHIEVEMENTS.map((a) => [a.id, { got: flags.has(a.id) }]));
  const earn = (id: string, at?: number) => {
    const b = out.get(id)!;
    if (!b.got) out.set(id, { ...b, got: true, at });
  };
  const count = (id: string, n: number, of: number, at?: number) => {
    out.set(id, { ...out.get(id)!, progress: { n: Math.min(n, of), of } });
    if (n >= of) earn(id, at);
  };

  // oldest first, for streaks and counts
  const trades = history.filter((i) => i.kind === "trade").reverse();
  const markets = new Set<string>();
  const won = new Set<string>();
  let wins = 0;
  let losses = 0;
  let bestWins = 0;
  let worstLosses = 0;
  let rekt = 0;
  trades.forEach((i, k) => {
    if (i.kind !== "trade") return;
    const t = i.trade;
    const at = t.closed_t;
    const pnl = BigInt(t.pnl);
    const margin = BigInt(t.margin);
    markets.add(t.market_id);
    if (pnl > 0n) won.add(t.side);
    if (k === 0) earn("player1", at);
    count("regular", k + 1, 25, at);
    count("centurion", k + 1, 100, at);
    count("globetrotter", markets.size, 3, at);
    if (won.size === 2) earn("switch", at);
    if (t.reason === "Target") earn("sharpshooter", at);
    if (t.reason === "Stop") earn("stopped", at);
    if (pnl > 0n && at - t.opened_t <= 120_000) earn("paperhands", at);
    if (at - t.opened_t >= 30 * 60_000) earn("hodl", at);
    if (t.leverage >= 100) earn("degen", at);
    if (margin >= 10_000_000_000n) earn("whale", at);
    if (pnl >= margin) earn("moon", at);
    if (pnl >= 1_000_000_000n) earn("bigwin", at);
    if (t.reason === "TakeProfit" || pnl >= 9n * margin) earn("maxwin", at);
    if (pnl <= -1_000_000_000n) earn("ouch", at);
    if (t.reason === "Liquidation") {
      rekt++;
      earn("rekt", at);
    }
    count("serialrekt", rekt, 5, at);
    if (pnl > 0n && losses >= 5) earn("comeback", at);
    wins = pnl > 0n ? wins + 1 : 0;
    losses = pnl < 0n ? losses + 1 : 0;
    bestWins = Math.max(bestWins, wins);
    worstLosses = Math.max(worstLosses, losses);
    if (wins >= 3) earn("hot3", at);
    if (wins >= 5) earn("fire5", at);
    if (losses >= 3) earn("cold3", at);
    if (losses >= 5) earn("bottom5", at);
  });
  // streaks show the best run so far
  for (const [id, of, n] of [["hot3", 3, bestWins], ["fire5", 5, bestWins], ["cold3", 3, worstLosses], ["bottom5", 5, worstLosses]] as const)
    out.set(id, { ...out.get(id)!, progress: { n: Math.min(n, of), of } });

  const first = (k: HistoryItem["kind"], ok: (i: HistoryItem) => boolean = () => true) =>
    [...history].reverse().find((i) => i.kind === k && ok(i))?.t;
  const lifeAt = first("life");
  if (lives.length || lifeAt) earn("oneup", lifeAt);
  const claimAt = first("claim_usdc");
  if (claimAt) earn("payback", claimAt);
  if (lives.some((l) => l.full_heal)) earn("fullheal");
  count("collector", lives.filter((l) => !l.expired && !l.full_heal).length, 5);
  const marketAt = first("bought") ?? first("sold");
  if (marketAt) earn("trader", marketAt);
  const soldLife = first("sold", (i) => i.kind === "sold" && i.what === "Extra Life");
  if (soldLife) earn("exit", soldLife);
  const backed = first("backed");
  if (backed) earn("backer", backed);
  if (locks.some((l) => !l.from_loss && l.end - l.created >= 103)) earn("diamond");
  return out;
}

export function earned(history: HistoryItem[], lives: LifeInfo[], locks: LockInfo[], flags: Set<string>): Set<string> {
  return new Set([...badgeStates(history, lives, locks, flags)].filter(([, b]) => b.got).map(([id]) => id));
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
