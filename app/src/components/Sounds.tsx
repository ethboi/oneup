"use client";

// Plays the moments that happen on chain rather than on a click: your order filling, a trade closing (win,
// loss, liquidation, take-profit, stop) and a new Extra Life. Also the header's mute button.

import { useEffect, useRef, useState } from "react";
import { useOneUp, usePoll } from "@/lib/oneup";
import { isMuted, onMuted, setMuted, sfx } from "@/lib/sound";
import { useHistory } from "./History";
import { Icon } from "./Icon";

export function SoundEvents() {
  const { o, me } = useOneUp();
  const positions = usePoll(() => o.positions(me), [me]);
  const history = useHistory(me);
  const seen = useRef<{ me: string; ids: Set<number> } | null>(null);
  const lastSeq = useRef<{ me: string; seq: number } | null>(null);

  // a new position id for this account: an order filled
  useEffect(() => {
    if (!positions) return;
    const ids = new Set(positions.map((p) => p.id));
    const prev = seen.current;
    if (prev && prev.me === me && positions.some((p) => !prev.ids.has(p.id))) sfx("fill");
    seen.current = { me, ids };
  }, [positions, me]);

  // new history: closed trades and Extra Lives (the first load is the baseline, not news)
  useEffect(() => {
    if (!history?.synced) return;
    const top = history.items[0]?.seq ?? 0;
    const prev = lastSeq.current;
    lastSeq.current = { me, seq: top };
    if (!prev || prev.me !== me) return;
    const fresh = history.items.filter((i) => i.seq > prev.seq);
    const life = fresh.some((i) => i.kind === "life");
    const trade = fresh.find((i) => i.kind === "trade");
    if (trade?.kind === "trade") {
      const { reason, pnl } = trade.trade;
      if (reason === "Liquidation") sfx("liquidated");
      else sfx(BigInt(pnl) < 0n ? "lose" : "win");
      // a loss is an Extra Life on its way
      if (reason === "Liquidation" || BigInt(pnl) < 0n) sfx("plusOne");
    } else if (life) {
      sfx("life");
    }
  }, [history, me]);

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
