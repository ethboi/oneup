"use client";

// The console's mood: a gauge on the screen shows how far the price is from liquidation and from your
// take-profit. Near liquidation the screen pulses red with a heartbeat that quickens (and a warning beep at
// the end). Near a take-profit (or the 9× cap) it glows and a shimmer climbs. A win bursts coins; a
// liquidation shakes the case. Sound follows the mute button; motion follows reduced-motion.

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
  /** The position the gauge shows (the most endangered): its liquidation, entry and target prices. */
  gauge?: { liq: number; entry: number; target: number; mark: number; capped: boolean };
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
    let gauge: Mood["gauge"];
    for (const p of live) {
      const entry = Number(p.entry_price);
      const liq = Number(liquidationPrice(p.side, BigInt(p.entry_price), p.leverage));
      const h = 1 - along(entry, liq, m);
      const cap = entry * (1 + ((p.side === "Long" ? 1 : -1) * 9) / p.leverage);
      const target = p.triggers.take_profit ? Number(p.triggers.take_profit) : cap;
      progress = Math.max(progress, along(entry, target, m));
      if (!gauge || h < health) gauge = { liq, entry, target, mark: m, capped: !p.triggers.take_profit };
      health = Math.min(health, h);
    }
    const state = health < CRITICAL ? "critical" : health < DANGER ? "danger" : progress > HOT ? "hot" : "calm";
    return { state, health, progress, gauge };
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

/** Distance to liquidation and to the take-profit (or the 9× cap), on a gauge printed on the screen:
 *  liquidation at the left end, the target at the right, a tick at entry and a dot at the price. */
export function Gauge({ mood }: { mood: Mood }) {
  const g = mood.gauge;
  if (!g) return null;
  const pct = (to: number) => `${((Math.abs(to - g.mark) / g.mark) * 100).toFixed(1)}%`;
  const at = (x: number) => `${along(g.liq, g.target, x) * 100}%`;
  const danger = mood.state === "danger" || mood.state === "critical";
  const hot = mood.state === "hot";
  return (
    <span
      className="display num flex items-center gap-2 text-sm text-[var(--lcd-ink)]"
      role="img"
      aria-label={`Liquidation ${pct(g.liq)} away, ${g.capped ? "profit cap" : "take profit"} ${pct(g.target)} away`}
    >
      <span style={danger ? { color: "#c43636" } : undefined}>LIQ {pct(g.liq)}</span>
      <span className="relative h-3 w-28 sm:w-40">
        <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-[var(--lcd-3)]" />
        <span className="absolute top-0 h-3 w-[2px] bg-[var(--lcd-3)]" style={{ left: at(g.entry) }} />
        <span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 border-2 border-[var(--lcd-ink)]"
          style={{ left: at(g.mark), background: danger ? "#c43636" : hot ? "#f2b705" : "var(--lcd-ink)" }}
        />
      </span>
      <span style={hot ? { color: "#7a5a00" } : undefined}>
        {g.capped ? "MAX" : "TP"} {pct(g.target)}
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
