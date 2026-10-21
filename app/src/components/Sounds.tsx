"use client";

// Plays the moments that happen on chain rather than on a click: your order filling, a trade closing (win,
// loss, liquidation, take-profit, stop), a new Extra Life and a Full Heal. Losses feed the TILT meter and a
// win after a near miss earns Clutch. Also the header's mute button.

import { useEffect, useRef, useState } from "react";
import { isLiquidatable, pnl } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { isMuted, onMuted, setMuted, sfx } from "@/lib/sound";
import { emitFx } from "@/lib/fx";
import { addFlag, nearMisses } from "@/lib/achievements";
import { REVENGE_MS, lastLossAt, recordLoss } from "@/lib/tilt";
import { Icon } from "./Icon";

export function SoundEvents() {
  const { o, me, prices } = useOneUp();
  // polled every second here, so a close or a new life sounds within about a second of landing on chain
  const positions = usePoll(() => o.positions(me), [me], 1000);
  const lives = usePoll(() => o.lives(me), [me], 1000);
  /** Each open position's PnL at the latest mark, to judge a close the moment the position is gone. */
  const open = useRef<{ me: string; pnl: Map<number, { v: bigint; margin: bigint; market: string }> } | null>(null);
  const known = useRef<{ me: string; ids: Set<string>; healed: Set<string> } | null>(null);

  useEffect(() => {
    if (!positions) return;
    const prev = open.current;
    const next = new Map<number, { v: bigint; margin: bigint; market: string }>();
    for (const p of positions) {
      const mark = prices[p.market_id];
      const margin = BigInt(p.margin);
      const v = mark ? pnl(p.side, margin, p.leverage, BigInt(p.entry_price), mark) : (prev?.pnl.get(p.id)?.v ?? 0n);
      next.set(p.id, { v, margin, market: p.market_id });
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
    for (const [id, { v, margin, market }] of prev.pnl) {
      if (next.has(id)) continue;
      // closed: by the last mark, a liquidation, a loss or a win (the exact fill may differ slightly)
      const kind = isLiquidatable(v, margin) ? "liquidated" : v < 0n ? "lose" : "win";
      sfx(kind);
      emitFx({ kind, market, positionId: id });
      if (v < 0n) {
        sfx("plusOne"); // a loss is an Extra Life on its way
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

export function MuteButton() {
  const [muted, set] = useState(false);
  useEffect(() => {
    set(isMuted());
    return onMuted(set);
  }, []);
  return (
    <button
      className="btn btn-ghost px-2.5"
      onClick={() => {
        setMuted(!muted);
        if (muted) sfx("fill"); // a sample, so you hear what you turned on
      }}
      aria-pressed={!muted}
      aria-label={muted ? "Sound off, turn on" : "Sound on, turn off"}
      title={muted ? "Sound off" : "Sound on"}
    >
      <Icon name={muted ? "soundOff" : "sound"} />
    </button>
  );
}
