"use client";

// The console's mood: a gauge on the screen shows how far the price is from liquidation and from your
// take-profit. Near liquidation the screen pulses red with a heartbeat that quickens (and a warning beep at
// the end). Near a take-profit (or the 9× cap) it glows and a shimmer climbs. A win bursts coins; a
// liquidation shakes the case. Sound follows the mute button; motion follows reduced-motion.

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtUsdc, liquidationPrice, type Position } from "@oneup/sdk";
import { heartbeat, lowHpBeep, shimmer } from "@/lib/sound";
import { useFx, type FxEvent } from "@/lib/fx";
import { setMusicTension } from "@/lib/music";
import { nearMisses } from "@/lib/achievements";
import { PixelAmount, PixelCoin } from "./Pixel";
import { lifeImage } from "@/lib/lifeArt";

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
      if (h < 0.25) nearMisses.add(p.id); // remembered for the Clutch badge
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
  const tense = mood.state === "danger" || mood.state === "critical";
  // the music sinks so the heartbeat comes through
  useEffect(() => setMusicTension(tense), [tense]);
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

/** A position's health as a game's HP: full at its entry (or better), empty at liquidation. */
export const hpOf = (liq: number, entry: number, mark: number) => Math.max(0, Math.min(1, along(liq, entry, mark)));

/** HP in ten segments, green to gold to red as it drains. */
export function HpBar({ hp, label, small }: { hp: number; label?: string; small?: boolean }) {
  const lit = Math.ceil(hp * 10);
  const color = hp > 0.6 ? "var(--hp-good)" : hp > 0.3 ? "var(--hp-mid)" : "var(--hp-low)";
  return (
    <span className={`hp-bar ${small ? "small" : ""} ${hp <= 0.3 ? "low" : ""}`} role="meter" aria-label={label ?? "Margin health"} aria-valuenow={Math.round(hp * 100)} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} style={i < lit ? { background: color } : undefined} />
      ))}
    </span>
  );
}

/** The position on the screen as a fighter's HP: how far it is from liquidation, and how far to its take-profit
 *  (or the 9× cap). */
export function Gauge({ mood }: { mood: Mood }) {
  const g = mood.gauge;
  if (!g) return null;
  const pct = (to: number) => `${((Math.abs(to - g.mark) / g.mark) * 100).toFixed(1)}%`;
  const hp = hpOf(g.liq, g.entry, g.mark);
  const hot = mood.state === "hot";
  return (
    <span
      // phones: the bar takes what the two readings leave, so a long one never runs off the screen
      className="display num flex w-full items-center gap-2 text-sm text-[var(--lcd-ink)] sm:w-auto"
      role="img"
      aria-label={`Margin health ${Math.round(hp * 100)}%: liquidation ${pct(g.liq)} away, ${g.capped ? "profit cap" : "take profit"} ${pct(g.target)} away`}
    >
      <span className="whitespace-nowrap" title={`Liquidation ${pct(g.liq)} away`}>
        Margin
      </span>
      <HpBar hp={hp} label={`Margin health, liquidation ${pct(g.liq)} away`} />
      <span className="whitespace-nowrap" style={hot ? { color: "#b07a00" } : undefined}>
        {g.capped ? "Max win" : "TP"} {pct(g.target)}
        <span className="hidden sm:inline"> away</span>
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
  const [fx, setFx] = useState<(CloseFx & { id: number }) | null>(null);
  useFx((e) => {
    if ((e.kind !== "win" && e.kind !== "lose" && e.kind !== "liquidated") || e.market !== market) return;
    const id = Date.now();
    setFx({ ...e, id });
    // a win holds a little longer so the amount can be read, longer still the bigger it is
    // a loss holds long enough to read the Extra Life card it may earn
    setTimeout(() => setFx((f) => (f?.id === id ? null : f)), e.kind === "win" ? WIN[e.tier ?? 1].hold : LIFE_HOLD);
  });
  return fx;
}

type CloseFx = Extract<FxEvent, { kind: "win" | "lose" | "liquidated" }>;
const LIFE_HOLD = 1900;

/** Each win tier's burst: coins thrown, how far, the amount's height in px, how long it holds. */
const WIN = [
  { coins: 8, reach: 0.75, size: 30, hold: 1800 },
  { coins: 14, reach: 1, size: 40, hold: 2400 },
  { coins: 24, reach: 1.3, size: 52, hold: 2800 },
  { coins: 36, reach: 1.6, size: 66, hold: 3400 },
] as const;

/** A coin's throw: fixed per index so renders agree. */
const throwOf = (i: number, n: number, reach: number) => ({
  dx: Math.round(Math.cos((i / n) * Math.PI * 2 + i * 0.7) * (90 + (i % 3) * 40) * reach),
  dy: Math.round((-60 - (i % 4) * 35) * reach),
  d: (i % 5) * 0.04 + (i >= 14 ? 0.12 : 0),
});

/** Coins falling across the whole screen, for the biggest wins. */
const RAIN = Array.from({ length: 18 }, (_, i) => ({ x: ((i * 37) % 100) + 0.5, d: (i % 6) * 0.11 + 0.15, s: 16 + (i % 3) * 4 }));

export function Burst({ fx }: { fx: CloseFx & { id: number } }) {
  // the key restarts the animation for each close
  if (fx.kind === "win") {
    const won = fx.pnl ? BigInt(fx.pnl) : 0n;
    const tier = fx.tier ?? 1;
    const w = WIN[tier];
    return (
      <div key={fx.id} className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden>
        {tier >= 2 && <div className="win-flash absolute inset-0" />}
        {tier === 3 &&
          RAIN.map((r, i) => (
            <span key={`r${i}`} className="coin-rain absolute top-0" style={{ left: `${r.x}%`, animationDelay: `${r.d}s` }}>
              <PixelCoin size={r.s} />
            </span>
          ))}
        {Array.from({ length: w.coins }, (_, i) => {
          const c = throwOf(i, w.coins, w.reach);
          return (
            <span key={i} className="coin-fly absolute" style={{ "--dx": `${c.dx}px`, "--dy": `${c.dy}px`, animationDelay: `${c.d}s` } as React.CSSProperties}>
              <PixelCoin size={tier >= 2 ? 26 : 22} />
            </span>
          );
        })}
        {won > 0n && (
          <span className="absolute flex flex-col items-center">
            {tier === 3 && <span className="win-amount win-banner display">BIG WIN</span>}
            <span
              className={`win-amount ${tier === 3 ? "win-huge" : ""}`}
              style={tier === 3 ? undefined : { animationDuration: `${w.hold - 100}ms` }}
            >
              <PixelAmount text={`+$${fmtUsdc(won, won >= 1_000n * 1_000_000n ? 0 : 2)}`} height={w.size} />
            </span>
          </span>
        )}
      </div>
    );
  }
  const lost = fx.pnl && BigInt(fx.pnl) < 0n ? -BigInt(fx.pnl) : 0n;
  return (
    <div key={fx.id} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" aria-hidden>
      {/* the Extra Life this loss may earn, as a banner like the game's others: its heart empty until the round
          settles and pays */}
      <span className="life-banner">
        <span className="life-banner-top display">
          <span>EXTRA LIFE</span>
          <span className="life-banner-plus">+1</span>
        </span>
        <img className="life-banner-art" src={lifeImage(0n, 1n, "earning")} alt="" />
        <span className="display life-banner-big">{fx.kind === "liquidated" ? "LIQUIDATED" : "LOSS"}</span>
        <span className="life-banner-small">
          {fx.side && <span className={`life-card-side ${fx.side === "Short" ? "short" : "long"}`}>{fx.side.toUpperCase()}</span>}
          <span>
            {fx.market.split("-")[0]}
            {fx.leverage ? ` ${fx.leverage}×` : ""}
            {lost > 0n ? ` · −$${fmtUsdc(lost)}` : ""}
          </span>
        </span>
      </span>
    </div>
  );
}
