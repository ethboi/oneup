// A tiny event bus for one-off effects: the sound watcher (components/Sounds.tsx) announces a close or a Full
// Heal, and the console, the tilt meter and the Full Heal screen react.

import { useEffect, useRef } from "react";

export type FxEvent =
  /** `pnl`: USDC units after the winner's cut, judged at the last mark (the fill may differ slightly).
   *  `tier`: how big a win is (winTier), which sizes its burst. */
  | { kind: "win" | "lose" | "liquidated"; market: string; positionId: number; pnl?: string; tier?: WinTier; side?: "Long" | "Short"; leverage?: number }
  | { kind: "heal"; tokenId: string; epoch: number; paid: string }
  | { kind: "revenge" }
  /** The game layer (components/Level.tsx, Game.tsx). */
  | { kind: "levelup"; level: number }
  /** A take-profit or stop-loss was set. */
  | { kind: "shield" }
  | { kind: "combo"; n: number }
  | { kind: "bigmove"; market: string; pct: number };

const subs = new Set<(e: FxEvent) => void>();

export const emitFx = (e: FxEvent) => subs.forEach((f) => f(e));

// tests can fire an effect (a Full Heal takes many epochs to happen for real)
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __oneupFx?: typeof emitFx }).__oneupFx = emitFx;
}

export function useFx(f: (e: FxEvent) => void) {
  const ref = useRef(f);
  ref.current = f;
  useEffect(() => {
    const h = (e: FxEvent) => ref.current(e);
    subs.add(h);
    return () => void subs.delete(h);
  }, []);
}

export type WinTier = 0 | 1 | 2 | 3;

/** How big a win feels, by dollars or by return on margin, whichever is bigger: 0 small, 1 good, 2 big, 3 huge
 *  (from $2,500 or 5× the margin, over halfway to the 9× cap). */
export function winTier(pnl: bigint, margin: bigint): WinTier {
  const usd = Number(pnl) / 1e6;
  const roe = margin > 0n ? Number(pnl) / Number(margin) : 0;
  const byUsd = usd >= 2500 ? 3 : usd >= 500 ? 2 : usd >= 50 ? 1 : 0;
  const byRoe = roe >= 5 ? 3 : roe >= 2 ? 2 : roe >= 0.5 ? 1 : 0;
  return Math.max(byUsd, byRoe) as WinTier;
}
