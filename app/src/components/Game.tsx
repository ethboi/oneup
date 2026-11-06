"use client";

// The trading screen's progress layer, in trading terms: a strip on the bezel (your trader
// tier and points, your win streak, and the house's P&L this round), banners on the screen for a tier-up, a win
// streak, a take-profit or stop-loss set and a big move, profit popping off your position as it gains, and daily
// goals. It rewards trading and planned exits, never risk: see lib/xp.ts.

import { useEffect, useRef, useState } from "react";
import { USDC, fmtUsdc, pnl, type Position } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { emitFx, useFx, type FxEvent } from "@/lib/fx";
import { sfx } from "@/lib/sound";
import { SKINS } from "@/lib/achievements";
import { questsOn, today } from "@/lib/xp";
import { LevelBar, useLevel } from "./Level";
import { useStreak } from "./Streaks";
import { useHistory } from "./History";
import { fmtDuration } from "./Jackpot";
import { useNow } from "./Header";

/** The house's P&L this round: what traders lost to it less what it paid winners. */
function useHouseRound() {
  const { o } = useOneUp();
  const epoch = usePoll(() => o.epoch(), [], 5000);
  if (!epoch) return null;
  return { round: epoch.id, net: BigInt(epoch.losses) - BigInt(epoch.payouts) };
}

/** The HUD printed on the console's bezel, above the screen. `score`: the position on screen's PnL. */
export function GameHud({ score }: { score?: React.ReactNode }) {
  const { me } = useOneUp();
  const lv = useLevel();
  const streak = useStreak(me);
  const combo = streak?.win && streak.n >= 2 ? streak.n : 0;
  const house = useHouseRound();
  // a combo that grows while you watch gets its banner
  const last = useRef<{ me: string; combo: number } | null>(null);
  useEffect(() => {
    const prev = last.current;
    last.current = { me, combo };
    if (prev && prev.me === me && combo > prev.combo && combo >= 2) {
      sfx("combo");
      emitFx({ kind: "combo", n: combo });
    }
  }, [combo, me]);
  return (
    <div className="game-hud num" aria-label="Trader progress">
      <LevelBar lv={lv} />
      {score}
      {combo >= 2 && (
        <span className="combo display" title={`${combo} winning trades in a row`}>
          WIN STREAK ×{combo}
        </span>
      )}
      {house && (
        <span className="house-pnl" title="What traders lost to the house this round, less what it paid winners">
          <span className="display house-name">
            <span className="hidden sm:inline">ROUND {house.round} · </span>HOUSE P&amp;L
          </span>
          <b className="num" style={{ color: house.net > 0n ? "var(--hp-good)" : house.net < 0n ? "#ff5a4f" : "#d6d7e6" }}>
            {house.net > 0n ? "+" : house.net < 0n ? "−" : ""}${fmtUsdc(house.net < 0n ? -house.net : house.net, (house.net < 0n ? -house.net : house.net) < 1_000n * USDC ? 2 : 0)}
          </b>
        </span>
      )}
    </div>
  );
}

type Banner = { id: number; kind: string; big: string; small?: string };

const bannerFor = (e: FxEvent): Omit<Banner, "id"> | null => {
  switch (e.kind) {
    case "levelup": {
      const shell = SKINS.find((s) => s.unlock && "level" in s.unlock && s.unlock.level === e.level);
      return { kind: "levelup", big: "TIER UP!", small: `Tier ${e.level}${shell ? ` · ${shell.name} shell unlocked` : ""}` };
    }
    case "combo":
      return { kind: "combo", big: `WIN STREAK ×${e.n}`, small: `${e.n} winning trades in a row` };
    case "shield":
      return { kind: "shield", big: "TP/SL SET", small: "Your exit is planned" };
    case "bigmove":
      return { kind: "bigmove", big: e.pct > 0 ? "BIG MOVE ▲" : "BIG MOVE ▼", small: `${e.market} ${e.pct > 0 ? "+" : "−"}${Math.abs(e.pct).toFixed(2)}% in one tick` };
    default:
      return null;
  }
};

/** A move this big in one price is a BIG MOVE. */
const BIG_MOVE = 0.12;

/** The screen's game moments: banners, and coins (or a red drop) popping off the position as the price moves. */
export function GameFx({ market, pos, mark, pts }: { market: string; pos?: Position; mark?: bigint; pts: { t: number; p: number }[] }) {
  const [banner, setBanner] = useState<Banner | null>(null);
  useFx((e) => {
    if (e.kind === "bigmove" && e.market !== market) return;
    const b = bannerFor(e);
    if (!b) return;
    const id = Date.now();
    setBanner({ ...b, id });
    setTimeout(() => setBanner((x) => (x?.id === id ? null : x)), b.kind === "levelup" ? 2800 : 1700);
  });

  // a big move: the newest price against the one before it
  const lastT = useRef(0);
  const head = pts.at(-1);
  const prev = pts.at(-2);
  useEffect(() => {
    if (!head || !prev || head.t === lastT.current) return;
    const first = lastT.current === 0;
    lastT.current = head.t;
    const pct = (head.p / prev.p - 1) * 100;
    if (!first && Math.abs(pct) >= BIG_MOVE) {
      sfx("bigmove");
      emitFx({ kind: "bigmove", market, pct });
    }
  }, [head?.t, head?.p, prev?.p, market]);

  // what the position on screen made or lost on each new price
  const [pops, setPops] = useState<{ id: number; text: string; up: boolean }[]>([]);
  const prevPnl = useRef<{ id: number; v: bigint } | null>(null);
  useEffect(() => {
    if (!pos || !mark) return;
    const v = pnl(pos.side, BigInt(pos.margin), pos.leverage, BigInt(pos.entry_price), mark);
    const before = prevPnl.current;
    prevPnl.current = { id: pos.id, v };
    if (!before || before.id !== pos.id) return;
    const d = v - before.v;
    if (d === 0n || (d < 0n ? -d : d) < USDC / 100n) return;
    const up = d > 0n;
    // a coin's chime for a gain worth hearing (half a percent of the margin)
    if (up && d * 200n >= BigInt(pos.margin)) sfx("coin");
    const id = Date.now() + Math.random();
    const a = up ? d : -d;
    setPops((ps) => [...ps.slice(-3), { id, up, text: `${up ? "+" : "−"}$${fmtUsdc(a, a < 1_000n * USDC ? 2 : 0)}` }]);
    setTimeout(() => setPops((ps) => ps.filter((p) => p.id !== id)), 1300);
  }, [mark, pos]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-live="polite">
      {pops.map((p, i) => (
        <span key={p.id} className={`pnl-pop display num ${p.up ? "up" : "down"}`} style={{ right: 110 + (i % 2) * 22, top: `${40 + (i % 3) * 6}%` }} aria-hidden>
          {p.up && <span className="pnl-coin" />}
          {p.text}
        </span>
      ))}
      {banner && (
        <span key={banner.id} className={`game-banner ${banner.kind}`} role="status">
          <span className="display game-banner-big">{banner.big}</span>
          {banner.small && <span className="game-banner-small">{banner.small}</span>}
        </span>
      )}
    </div>
  );
}

/** Four daily trading goals: +50 points each. */
export function Quests() {
  const { me } = useOneUp();
  const h = useHistory(me);
  const now = useNow();
  if (!h) return null;
  const qs = questsOn(h.items, today());
  const done = qs.filter((q) => q.n >= q.of).length;
  const resetIn = (today() + 1) * 86_400 - now;
  return (
    <section className="panel p-4" aria-label="Daily goals">
      <div className="ticket-row">
        <h3 className="display text-sm">Daily goals</h3>
        <span className="label num">
          {done}/{qs.length} · new in {fmtDuration(Math.max(0, resetIn))}
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        {qs.map((q) => {
          const ok = q.n >= q.of;
          return (
            <li key={q.id} className={`quest ${ok ? "done" : ""}`}>
              <span className="quest-check" aria-hidden>
                {ok ? "✓" : ""}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{q.name}</span>
                <span className="quest-track" aria-hidden>
                  <span style={{ width: `${(q.n / q.of) * 100}%` }} />
                </span>
              </span>
              <span className="num shrink-0 text-xs font-extrabold" style={{ color: ok ? "var(--long)" : "var(--muted)" }}>
                {ok ? "+50 pts" : `${q.n}/${q.of}`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
