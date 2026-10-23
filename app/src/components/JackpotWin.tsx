"use client";

// The draw (D-27): celebrate on the trading screen without interrupting recovery or purchases.
// Quiet screens still consume feed events; the Demo menu can explicitly preview the celebration anywhere.

import { useEffect, useMemo, useRef, useState } from "react";
import { USDC, fmtUsdc } from "@oneup/sdk";
import { useOneUp } from "@/lib/oneup";
import { latestJackpotWin } from "@/lib/jackpot";
import { sfx } from "@/lib/sound";
import { useActivity } from "./Activity";
import { PixelAmount, PixelCoin } from "./Pixel";
import { Icon } from "./Icon";

const short = (a: string) => a.replace(/\.test\.near$/, "");

export function JackpotWin({ automatic }: { automatic: boolean }) {
  const { me } = useOneUp();
  const items = useActivity(20);
  const seen = useRef<number | null>(null);
  const [win, setWin] = useState<{ who: string; amount: bigint; preview: boolean } | null>(null);

  useEffect(() => {
    const latest = latestJackpotWin(items);
    // what's already in the feed when the page opens isn't news
    if (seen.current === null) {
      seen.current = latest?.seq ?? 0;
      return;
    }
    if (!latest || latest.seq <= seen.current || !latest.amount) return;
    seen.current = latest.seq;
    if (!automatic) return;
    const mine = latest.who === short(me);
    sfx(mine ? "jackpot" : "win");
    setWin({ who: latest.who, amount: BigInt(latest.amount), preview: false });
  }, [items, me, automatic]);

  useEffect(() => {
    if (!automatic) setWin(current => current?.preview ? current : null);
  }, [automatic]);

  // the Demo menu's preview: you take a pot of the jackpot's current size, or a round number
  useEffect(() => {
    const show = (e: Event) => {
      sfx("jackpot");
      setWin({ who: short(me), amount: BigInt((e as CustomEvent<string>).detail || "250000000"), preview: true });
    };
    window.addEventListener("oneup-preview-jackpot", show);
    return () => window.removeEventListener("oneup-preview-jackpot", show);
  }, [me]);

  useEffect(() => {
    if (!win) return;
    const t = setTimeout(() => setWin(null), 9000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setWin(null);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [win]);

  const rain = useMemo(() => Array.from({ length: 28 }, (_, i) => ({ x: (i * 37) % 100, d: (i % 7) * 0.2, s: 16 + (i % 3) * 6 })), []);
  if (!win || (!automatic && !win.preview)) return null;
  const mine = win.who === short(me);

  return (
    <div className="fixed inset-0 z-[66] flex items-center justify-center overflow-hidden bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && setWin(null)}>
      {rain.map((r, i) => (
        <span key={i} className="coin-rain pointer-events-none absolute top-0" style={{ left: `${r.x}%`, animationDelay: `${r.d}s`, animationIterationCount: 3 }} aria-hidden>
          <PixelCoin size={r.s} />
        </span>
      ))}
      <div role="dialog" aria-label="Jackpot won" className="case relative flex w-full max-w-md flex-col items-center gap-3 p-6 text-center">
        <button className="btn btn-ghost absolute right-3 top-3 px-2.5" onClick={() => setWin(null)} aria-label="Close">
          <Icon name="x" />
        </button>
        <p className="display text-3xl" style={{ color: "var(--jackpot)" }}>
          JACKPOT!
        </p>
        <div className="bezel w-full rounded-xl px-3 py-3">
          <div className="lcd flex justify-center rounded-lg px-3 py-3">
            <PixelAmount text={`$${fmtUsdc(win.amount, win.amount < 1_000n * USDC ? 2 : 0)}`} height={52} />
          </div>
        </div>
        <p className="text-lg font-extrabold">{mine ? "That's you! It's in your balance." : `${win.who} won it`}</p>
        <p className="label">
          {mine ? "The house's interest, all of it, on one of your tickets." : "Every $1 you lose is a ticket for the next one."}
        </p>
      </div>
    </div>
  );
}
