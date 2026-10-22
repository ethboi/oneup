"use client";

// The Full Heal moment: an Extra Life has paid back everything it owed. Hearts rain, the house admits
// defeat, and there's a card to share. Triggered by components/Sounds.tsx when a life turns full_heal.

import { useEffect, useMemo, useState } from "react";
import { fmtUsdc } from "@oneup/sdk";
import { useOneUp } from "@/lib/oneup";
import { useFx } from "@/lib/fx";
import { sfx } from "@/lib/sound";
import { PixelHeart } from "./Pixel";
import { Icon } from "./Icon";
import { ShareDialog } from "./PnlCard";

export function FullHeal() {
  const { me } = useOneUp();
  const [heal, setHeal] = useState<{ epoch: number; paid: bigint } | null>(null);
  const [sharing, setSharing] = useState(false);
  useFx((e) => {
    if (e.kind !== "heal") return;
    sfx("heal");
    setHeal({ epoch: e.epoch, paid: BigInt(e.paid) });
  });
  useEffect(() => {
    if (!heal) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHeal(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [heal]);
  // a fixed scatter of falling hearts
  const rain = useMemo(() => Array.from({ length: 18 }, (_, i) => ({ x: (i * 37) % 100, d: (i % 6) * 0.25, s: 18 + (i % 3) * 8 })), []);
  if (!heal) return null;

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center overflow-hidden bg-black/55 p-4" onMouseDown={(e) => e.target === e.currentTarget && setHeal(null)}>
      {rain.map((r, i) => (
        <span key={i} className="heart-rain pointer-events-none absolute top-0" style={{ left: `${r.x}%`, animationDelay: `${r.d}s` }} aria-hidden>
          <PixelHeart size={r.s} />
        </span>
      ))}
      <div role="dialog" aria-label="Full Heal" className="case relative flex w-full max-w-[460px] flex-col items-center gap-3 p-6 text-center">
        <span className="heart-pop">
          <PixelHeart size={84} />
        </span>
        <h2 className="display text-5xl">FULL HEAL</h2>
        <p className="text-lg">
          <b>Revenge!</b> Your Extra Life from round {heal.epoch} paid you back <b className="num">${fmtUsdc(heal.paid)}</b> in full, out of
          the house&apos;s profit.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <button className="btn btn-accent" onClick={() => setSharing(true)}>
            <Icon name="share" />
            Share it
          </button>
          <button className="btn btn-ghost" onClick={() => setHeal(null)}>
            Continue
          </button>
        </div>
      </div>
      {sharing && (
        <ShareDialog
          data={{ market: "", side: "Long", leverage: 1, margin: 0n, pnl: heal.paid, entry: 0n, exit: 0n, state: "closed", account: me, heal }}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}
