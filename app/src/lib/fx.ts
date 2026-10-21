// A tiny event bus for one-off effects: the sound watcher (components/Sounds.tsx) announces a close, and the
// console plays its animation (coins for a win, a shake for a liquidation).

import { useEffect, useRef } from "react";

export type FxEvent = { kind: "win" | "lose" | "liquidated"; market: string };

const subs = new Set<(e: FxEvent) => void>();

export const emitFx = (e: FxEvent) => subs.forEach((f) => f(e));

export function useFx(f: (e: FxEvent) => void) {
  const ref = useRef(f);
  ref.current = f;
  useEffect(() => {
    const h = (e: FxEvent) => ref.current(e);
    subs.add(h);
    return () => void subs.delete(h);
  }, []);
}
