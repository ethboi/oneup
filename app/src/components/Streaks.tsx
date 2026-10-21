"use client";

// Streaks and revenge trades, for the console's screen: the current run of wins or losses (from your
// history) and a few seconds of "REVENGE TRADE DETECTED" after one is spotted (components/Sounds.tsx).

import { useState } from "react";
import { useFx } from "@/lib/fx";
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

/** A key that changes for each revenge trade, for about 3.5 s; null otherwise. */
export function useRevengeFlash(): number | null {
  const [at, setAt] = useState<number | null>(null);
  useFx((e) => {
    if (e.kind !== "revenge") return;
    const id = Date.now();
    setAt(id);
    setTimeout(() => setAt((x) => (x === id ? null : x)), 3600);
  });
  return at;
}
