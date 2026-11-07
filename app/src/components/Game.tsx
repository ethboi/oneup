"use client";

// The trading screen's progress layer, kept calm: a strip on the bezel (your position's P&L, the Classic screen,
// the jackpot and the house's P&L this round), one banner on the screen when you reach a new tier, and daily goals.
// Tier and points live in the achievements dialog. It rewards trading and planned exits, never risk: see lib/xp.ts.

import { useState } from "react";
import { USDC, fmtUsdc } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { useFx, type FxEvent } from "@/lib/fx";
import { SKINS } from "@/lib/achievements";
import { questsOn, today } from "@/lib/xp";
import { useHistory } from "./History";
import { fmtDuration } from "./Jackpot";
import { useNow } from "./Header";
import { useSkin } from "./Achievements";

/** The house's P&L this round: what traders lost to it less what it paid winners. */
function useHouseRound() {
  const { o } = useOneUp();
  const epoch = usePoll(() => o.epoch(), [], 5000);
  if (!epoch) return null;
  return { round: epoch.id, net: BigInt(epoch.losses) - BigInt(epoch.payouts) };
}

/** The HUD printed on the console's bezel, above the screen. `score`: the position on screen's PnL. */
/** The original one-colour screen, on the console's bezel, with or without a wallet. */
function ScreenSwitch() {
  const [skin, setSkin] = useSkin();
  const classic = skin === "classic";
  const toggle = () => {
    try {
      // coming back returns to the shell they had, such as one they unlocked
      if (!classic) localStorage.setItem("oneup.colourSkin", skin);
      setSkin(classic ? (localStorage.getItem("oneup.colourSkin") ?? "night") : "classic");
    } catch {
      setSkin(classic ? "night" : "classic");
    }
  };
  return (
    <button type="button" className="screen-switch" aria-pressed={classic} title="The original one-colour screen" onClick={toggle}>
      Classic
    </button>
  );
}

export function GameHud({ score, jackpot }: { score?: React.ReactNode; jackpot?: React.ReactNode }) {
  const house = useHouseRound();
  return (
    <div className="game-hud num" aria-label="Round and position">
      {score}
      <ScreenSwitch />
      {jackpot}
      {house && (
        <span className="house-pnl" title="What traders lost to the house this round, less what it paid winners">
          <span className="display house-name">
            <span className="hidden sm:inline">ROUND {house.round} · </span>HOUSE<span className="hidden sm:inline"> P&amp;L</span>
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
    default:
      return null;
  }
};

/** The one banner over the chart: reaching a new tier. */
export function GameFx() {
  const [banner, setBanner] = useState<Banner | null>(null);
  useFx((e) => {
    const b = bannerFor(e);
    if (!b) return;
    const id = Date.now();
    setBanner({ ...b, id });
    setTimeout(() => setBanner((x) => (x?.id === id ? null : x)), 2800);
  });
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-live="polite">
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
