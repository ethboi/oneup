// A tiny event bus for one-off effects: the sound watcher (components/Sounds.tsx) announces a close or a Full
// Heal, and the console, the tilt meter and the Full Heal screen react.

import { useEffect, useRef } from "react";

export type FxEvent =
  | { kind: "win" | "lose" | "liquidated"; market: string; positionId: number }
  | { kind: "heal"; tokenId: string; epoch: number; paid: string }
  | { kind: "revenge" };

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
