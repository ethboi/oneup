"use client";

// The trading screen's game layer, on a Game Boy Color: a HUD on the bezel (your level, your combo, and the
// round's boss, the house, with its HP), banners on the screen for a level-up, a combo, a shield (a
// take-profit or stop-loss set) and a big move, coins popping off your position as it gains, and daily quests.
// It rewards playing and playing well, never risk: see lib/xp.ts.

import { useEffect, useRef, useState } from "react";
import { USDC, fmtUsdc, pnl, type Position } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { emitFx, useFx, type FxEvent } from "@/lib/fx";
import { sfx } from "@/lib/sound";
import { SKINS } from "@/lib/achievements";
import { questsOn, today } from "@/lib/xp";
import { HpBar } from "./Mood";
import { LevelBar, useLevel } from "./Level";
import { useStreak } from "./Streaks";
import { useHistory } from "./History";
import { fmtDuration } from "./Jackpot";
import { useNow } from "./Header";

/** The round's boss: the house, at full HP when the round starts. Winners' payouts hit it, losers' losses heal
 *  it, and it can't go above full. Its HP is a share of the pool, so a big house takes a lot of beating. */
function useBoss() {
  const { o } = useOneUp();
  const epoch = usePoll(() => o.epoch(), [], 5000);
  const pool = BigInt(usePoll(() => o.pool(), [], 15_000) ?? "0");
  if (!epoch) return null;
  const max = pool / 200n > 1_000n * USDC ? pool / 200n : 1_000n * USDC;
  const left = max + BigInt(epoch.losses) - BigInt(epoch.payouts);
  const hp = left <= 0n ? 0 : left >= max ? 1 : Number((left * 1000n) / max) / 1000;
  return { round: epoch.id, hp, left: left < 0n ? 0n : left > max ? max : left, max };
}

/** The HUD printed on the console's bezel, above the screen. */
export function GameHud() {
  const { me } = useOneUp();
  const lv = useLevel();
  const streak = useStreak(me);
  const combo = streak?.win && streak.n >= 2 ? streak.n : 0;
  const boss = useBoss();
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
    <div className="game-hud num" aria-label="Game">
      <LevelBar lv={lv} />
      {combo >= 2 && (
        <span className="combo display" title={`${combo} wins in a row`}>
          COMBO ×{combo}
        </span>
      )}
      {boss && (
        <span className="boss" title={`The house: $${fmtUsdc(boss.left, 0)} of $${fmtUsdc(boss.max, 0)} HP. Winners' payouts hit it, losses heal it.`}>
          <span className="display boss-name">
            <span className="hidden sm:inline">ROUND {boss.round} BOSS: </span>THE HOUSE
          </span>
          <HpBar hp={boss.hp} label={`The house's HP, ${Math.round(boss.hp * 100)}%`} />
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
      return { kind: "levelup", big: "LEVEL UP!", small: `LV ${e.level}${shell ? ` · ${shell.name} shell unlocked` : ""}` };
    }
    case "combo":
      return { kind: "combo", big: `COMBO ×${e.n}!`, small: `${e.n} wins in a row` };
    case "shield":
      return { kind: "shield", big: "SHIELD UP!", small: "Take-profit / stop-loss set" };
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

/** Four small quests a day, done by trading: +50 XP each. */
export function Quests() {
  const { me } = useOneUp();
  const h = useHistory(me);
  const now = useNow();
  if (!h) return null;
  const qs = questsOn(h.items, today());
  const done = qs.filter((q) => q.n >= q.of).length;
  const resetIn = (today() + 1) * 86_400 - now;
  return (
    <section className="panel p-4" aria-label="Daily quests">
      <div className="ticket-row">
        <h3 className="display text-sm">Daily quests</h3>
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
                {ok ? "+50 XP" : `${q.n}/${q.of}`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
