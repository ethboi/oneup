"use client";

// Streaks and revenge trades, for the console's screen: the current run of wins or losses (from your
// history) and a few seconds of "REVENGE TRADE DETECTED" after one is spotted (components/Sounds.tsx).

import { useHistory } from "./History";

/** Your current streak: consecutive wins or losses, newest first. */
export function useStreak(account: string): { win: boolean; n: number } | null {
  const h = useHistory(account);
  const trades = (h?.items ?? []).filter((i) => i.kind === "trade");
  if (trades.length === 0) return null;
  const sign = (i: (typeof trades)[number]) => (i.kind === "trade" ? BigInt(i.trade.pnl) : 0n);
  const win = sign(trades[0]) > 0n;
  let n = 0;
  for (const t of trades) {
    if (sign(t) > 0n !== win || sign(t) === 0n) break;
    n++;
  }
  return { win, n };
}

