"use client";

// Plays the moments that happen on chain rather than on a click: your order filling, a trade closing (win,
// loss, liquidation, take-profit, stop), a new Life NFT and a Full Heal. Losses feed the TILT meter and a
// win after a near miss earns Clutch. Also the header's sound menu (effects and music).

import { useEffect, useRef, useState } from "react";
import { canVibrate, hapticsOn, setHaptics } from "@/lib/haptics";
import { PPM, isLiquidatable, pnl } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { isMuted, onMuted, setMuted, sfx } from "@/lib/sound";
import { isMusicOn, onMusic, setMusic, sync as syncMusic } from "@/lib/music";
import { emitFx, winTier } from "@/lib/fx";
import { addFlag, nearMisses } from "@/lib/achievements";
import { REVENGE_MS, lastLossAt, recordLoss } from "@/lib/tilt";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

export function SoundEvents() {
  const { o, me, prices } = useOneUp();
  // polled every second here, so a close or a new life sounds within about a second of landing on chain
  const positions = usePoll(() => o.positions(me), [me], 1000);
  const lives = usePoll(() => o.lives(me), [me], 1000);
  /** Each open position's PnL at the latest mark, to judge a close the moment the position is gone. */
  const open = useRef<{ me: string; pnl: Map<number, { v: bigint; margin: bigint; cut: bigint; market: string; side: "Long" | "Short"; leverage: number }> } | null>(null);
  const known = useRef<{ me: string; ids: Set<string>; healed: Set<string> } | null>(null);

  useEffect(() => {
    if (!positions) return;
    const prev = open.current;
    const next = new Map<number, { v: bigint; margin: bigint; cut: bigint; market: string; side: "Long" | "Short"; leverage: number }>();
    for (const p of positions) {
      const mark = prices[p.market_id];
      const margin = BigInt(p.margin);
      const v = mark ? pnl(p.side, margin, p.leverage, BigInt(p.entry_price), mark) : (prev?.pnl.get(p.id)?.v ?? 0n);
      next.set(p.id, { v, margin, cut: BigInt(p.cut_ppm), market: p.market_id, side: p.side, leverage: p.leverage });
    }
    open.current = { me, pnl: next };
    if (!prev || prev.me !== me) return;
    if (positions.some((p) => !prev.pnl.has(p.id))) {
      sfx("fill");
      // opened soon after a losing close: call it out
      if (Date.now() - lastLossAt(me) < REVENGE_MS) {
        setTimeout(() => sfx("revenge"), 350);
        emitFx({ kind: "revenge" });
        addFlag(me, "revengetrader");
      }
    }
    for (const [id, { v, margin, cut, market, side, leverage }] of prev.pnl) {
      if (next.has(id)) continue;
      // closed: by the last mark, a liquidation, a loss or a win (the exact fill may differ slightly)
      const kind = isLiquidatable(v, margin) ? "liquidated" : v < 0n ? "lose" : "win";
      // a winner keeps its profit less the cut, which rounds up
      const net = v > 0n ? v - (v * cut + PPM - 1n) / PPM : v;
      const tier = kind === "win" ? winTier(net, margin) : undefined;
      sfx(tier === 3 ? "jackpot" : kind);
      emitFx({ kind, market, positionId: id, pnl: net.toString(), tier, side, leverage });
      if (v < 0n) {
        sfx("plusOne"); // a loss is a Life NFT on its way
        if (recordLoss(me)) {
          setTimeout(() => sfx("tilt"), 900);
          addFlag(me, "tilted");
        }
      } else if (nearMisses.has(id)) {
        addFlag(me, "clutch");
      }
      break;
    }
  }, [positions, prices, me]);

  // a life we haven't seen (minted at the epoch close), or one that has just been paid back in full
  useEffect(() => {
    if (!lives) return;
    const ids = new Set(lives.map((l) => l.token_id));
    const healed = new Set(lives.filter((l) => l.full_heal).map((l) => l.token_id));
    const prev = known.current;
    known.current = { me, ids, healed };
    if (!prev || prev.me !== me) return;
    if (lives.some((l) => !prev.ids.has(l.token_id))) sfx("life");
    for (const l of lives) {
      if (l.full_heal && prev.ids.has(l.token_id) && !prev.healed.has(l.token_id)) {
        emitFx({ kind: "heal", tokenId: l.token_id, epoch: l.epoch, paid: l.paid });
      }
    }
  }, [lives, me]);

  return null;
}

/** The header's sound menu: sound effects on or off, and the music (which needs sound on). */
export function MuteButton() {
  const [muted, setM] = useState(false);
  const [music, setMu] = useState(false);
  const [haptics, setHap] = useState(true);
  const [vibrate, setVibrate] = useState(false);
  useEffect(() => {
    setHap(hapticsOn());
    setVibrate(canVibrate());
  }, []);
  useEffect(() => {
    setM(isMuted());
    setMu(isMusicOn());
    const offs = [onMuted(setM), onMusic(setMu)];
    // browsers start audio only after a click: pick the music back up on the first one
    const first = () => syncMusic();
    window.addEventListener("pointerdown", first, { once: true });
    return () => {
      offs.forEach((f) => f());
      window.removeEventListener("pointerdown", first);
    };
  }, []);
  return (
    <Popover label={muted ? "Sound off" : "Sound on"} button={<Icon name={muted ? "soundOff" : music ? "music" : "sound"} />}>
      {() => (
        <div className="flex w-56 flex-col gap-1">
          <Toggle
            label="Sound effects"
            on={!muted}
            set={(v) => {
              setMuted(!v);
              if (v) sfx("fill"); // a sample, so you hear what you turned on
            }}
          />
          <Toggle label="Music" hint={muted ? "Needs sound on" : undefined} on={music && !muted} disabled={muted} set={setMusic} />
          {/* phones that can vibrate: a buzz on fills, wins, liquidations and level-ups */}
          {vibrate && <Toggle label="Vibration" on={haptics} set={(v) => (setHaptics(v), setHap(v))} />}
        </div>
      )}
    </Popover>
  );
}

function Toggle({ label, hint, on, disabled, set }: { label: string; hint?: string; on: boolean; disabled?: boolean; set: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => set(!on)}
      className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm font-bold hover:bg-[var(--panel-2)] disabled:opacity-50"
    >
      <span>
        {label}
        {hint && <span className="label block font-normal">{hint}</span>}
      </span>
      <span className={`switch ${on ? "switch-on" : ""}`} aria-hidden />
    </button>
  );
}
