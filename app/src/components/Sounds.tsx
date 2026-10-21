"use client";

// Plays the moments that happen on chain rather than on a click: your order filling, a trade closing (win,
// loss, liquidation, take-profit, stop) and a new Extra Life. Also the header's mute button.

import { useEffect, useRef, useState } from "react";
import { isLiquidatable, pnl } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { isMuted, onMuted, setMuted, sfx } from "@/lib/sound";
import { Icon } from "./Icon";

export function SoundEvents() {
  const { o, me, prices } = useOneUp();
  // polled every second here, so a close or a new life sounds within about a second of landing on chain
  const positions = usePoll(() => o.positions(me), [me], 1000);
  const lives = usePoll(() => o.lives(me), [me], 1000);
  /** Each open position's PnL at the latest mark, to judge a close the moment the position is gone. */
  const open = useRef<{ me: string; pnl: Map<number, { v: bigint; margin: bigint }> } | null>(null);
  const known = useRef<{ me: string; ids: Set<string> } | null>(null);

  useEffect(() => {
    if (!positions) return;
    const prev = open.current;
    const next = new Map<number, { v: bigint; margin: bigint }>();
    for (const p of positions) {
      const mark = prices[p.market_id];
      const margin = BigInt(p.margin);
      next.set(p.id, { v: mark ? pnl(p.side, margin, p.leverage, BigInt(p.entry_price), mark) : (prev?.pnl.get(p.id)?.v ?? 0n), margin });
    }
    open.current = { me, pnl: next };
    if (!prev || prev.me !== me) return;
    if (positions.some((p) => !prev.pnl.has(p.id))) sfx("fill");
    for (const [id, { v, margin }] of prev.pnl) {
      if (next.has(id)) continue;
      // closed: by the last mark, a liquidation, a loss or a win (the exact fill may differ slightly)
      if (isLiquidatable(v, margin)) sfx("liquidated");
      else sfx(v < 0n ? "lose" : "win");
      if (v < 0n) sfx("plusOne"); // a loss is an Extra Life on its way
      break;
    }
  }, [positions, prices, me]);

  // a life we haven't seen: minted at the epoch close
  useEffect(() => {
    if (!lives) return;
    const ids = new Set(lives.map((l) => l.token_id));
    const prev = known.current;
    known.current = { me, ids };
    if (prev && prev.me === me && lives.some((l) => !prev.ids.has(l.token_id))) sfx("life");
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
