"use client";

// The console's mood: your margin as health. An HP bar on the screen drains toward liquidation; near it the
// screen pulses red with a heartbeat that quickens (and a low-HP beep at the end). Near a take-profit (or the
// 9× cap) it glows and a shimmer climbs. A win bursts coins; a liquidation shakes the case. Sound follows
// the mute button; motion follows reduced-motion.

import { useEffect, useMemo, useRef, useState } from "react";
import { liquidationPrice, type Position } from "@oneup/sdk";
import { heartbeat, lowHpBeep, shimmer } from "@/lib/sound";
import { useFx, type FxEvent } from "@/lib/fx";
import { PixelCoin, PixelHeart } from "./Pixel";

export interface Mood {
  state: "none" | "calm" | "danger" | "critical" | "hot";
  /** 1 at entry (or better), 0 at liquidation. */
  health: number;
  /** 0 at entry, 1 at the take-profit (or the 9× cap). */
  progress: number;
}

const DANGER = 0.3;
const CRITICAL = 0.12;
const HOT = 0.7;

/** Where the price sits between `from` and `to`, 0–1, for either side. */
const along = (from: number, to: number, at: number) => (to === from ? 0 : Math.min(1, Math.max(0, (at - from) / (to - from))));

/** The mood of your positions in this market at `mark`: the most endangered one wins, then the hottest. */
export function useMood(positions: Position[], mark?: bigint): Mood {
  return useMemo(() => {
    const live = positions.filter((p) => p.close_order === null);
    if (live.length === 0 || !mark) return { state: "none", health: 1, progress: 0 };
    const m = Number(mark);
    let health = 1;
    let progress = 0;
    for (const p of live) {
      const entry = Number(p.entry_price);
      const liq = Number(liquidationPrice(p.side, BigInt(p.entry_price), p.leverage));
      health = Math.min(health, 1 - along(entry, liq, m));
      const cap = entry * (1 + ((p.side === "Long" ? 1 : -1) * 9) / p.leverage);
      const target = p.triggers.take_profit ? Number(p.triggers.take_profit) : cap;
      progress = Math.max(progress, along(entry, target, m));
    }
    const state = health < CRITICAL ? "critical" : health < DANGER ? "danger" : progress > HOT ? "hot" : "calm";
    return { state, health, progress };
  }, [positions, mark]);
}

/** The heartbeat, beep and shimmer loops. Beats are scheduled one at a time so the pace follows the price. */
export function useTensionSound(mood: Mood) {
  const ref = useRef(mood);
  ref.current = mood;
  const active = mood.state === "danger" || mood.state === "critical" || mood.state === "hot";
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    let n = 0;
    const tick = () => {
      const m = ref.current;
      let wait = 1000;
      if (document.visibilityState === "visible") {
        if (m.state === "danger" || m.state === "critical") {
          heartbeat();
          if (m.state === "critical" && n % 2 === 0) setTimeout(lowHpBeep, 420);
          // 1.2 s between beats at the edge of danger, down to 0.4 s at liquidation
          wait = 400 + (m.health / DANGER) * 800;
        } else if (m.state === "hot") {
          shimmer(m.progress);
          wait = 700 - ((m.progress - HOT) / (1 - HOT)) * 450;
        }
      }
      n++;
      timer = setTimeout(tick, Math.max(250, wait));
    };
    tick();
    return () => clearTimeout(timer);
  }, [active]);
}

/** Your health as an HP bar printed on the screen: segments in LCD ink, red once in danger. Hearts stay for
 *  Extra Lives, so the two never read as the same thing. */
export function HpBar({ health }: { health: number }) {
  const lit = Math.ceil(Math.max(0, Math.min(1, health)) * 10);
  const danger = health < DANGER;
  return (
    <span className="flex items-center gap-1.5" role="meter" aria-label="Health: margin left before liquidation" aria-valuenow={Math.round(health * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span className="display text-sm text-[var(--lcd-ink)]">HP</span>
      <span className="flex gap-[2px] rounded-[3px] border-2 border-[var(--lcd-ink)] p-[2px]">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="h-2.5 w-2" style={{ background: i < lit ? (danger ? "#c43636" : "var(--lcd-ink)") : "transparent" }} />
        ))}
      </span>
    </span>
  );
}

/** The screen's glow: a red pulse in danger (faster when critical), a gold one near the target. */
export function MoodGlow({ mood }: { mood: Mood }) {
  if (mood.state === "none" || mood.state === "calm") return null;
  const beat = mood.state === "hot" ? 1.4 : (400 + (mood.health / DANGER) * 800) / 1000;
  return <div className={`mood-glow mood-${mood.state}`} style={{ "--beat": `${beat}s` } as React.CSSProperties} aria-hidden />;
}

/** One-off effects for closes in this market: a coin burst for a win, a cracked heart then a +1 for a loss. */
export function useCloseFx(market: string) {
  const [fx, setFx] = useState<(FxEvent & { id: number }) | null>(null);
  useFx((e) => {
    if (e.market !== market) return;
    const id = Date.now();
    setFx({ ...e, id });
    setTimeout(() => setFx((f) => (f?.id === id ? null : f)), 1600);
  });
  return fx;
}

export function Burst({ fx }: { fx: FxEvent & { id: number } }) {
  // fixed scatter so renders agree; the key restarts the animation for each close
  const coins = useMemo(
    () => Array.from({ length: 14 }, (_, i) => ({ dx: Math.round(Math.cos((i / 14) * Math.PI * 2) * (90 + (i % 3) * 40)), dy: -60 - (i % 4) * 35, d: (i % 5) * 0.04 })),
    [],
  );
  if (fx.kind === "win") {
    return (
      <div key={fx.id} className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
        {coins.map((c, i) => (
          <span key={i} className="coin-fly absolute" style={{ "--dx": `${c.dx}px`, "--dy": `${c.dy}px`, animationDelay: `${c.d}s` } as React.CSSProperties}>
            <PixelCoin size={22} />
          </span>
        ))}
      </div>
    );
  }
  return (
    <div key={fx.id} className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
      <span className="relative">
        <span className="heart-crack block">
          <PixelHeart size={72} fill={0} />
        </span>
        <span className="heart-plus absolute inset-0">
          <PixelHeart size={72} />
          <span className="display absolute -top-4 left-1/2 -translate-x-1/2 text-2xl text-[var(--heart)]">+1</span>
        </span>
      </span>
    </div>
  );
}
