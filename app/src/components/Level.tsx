"use client";

// XP and levels on screen (lib/xp.ts): your level and how far into it, and a LEVEL UP! when a close takes
// you over the line.

import { useEffect, useRef } from "react";
import { useOneUp } from "@/lib/oneup";
import { emitFx } from "@/lib/fx";
import { sfx } from "@/lib/sound";
import { historyXp, levelOf, type Level } from "@/lib/xp";
import { useHistory } from "./History";

/** The account's level, or null until its history has loaded. Announces a level-up as it happens. */
export function useLevel(account?: string): Level | null {
  const { me } = useOneUp();
  const who = account ?? me;
  const h = useHistory(who);
  const lv = h ? levelOf(historyXp(h.items)) : null;
  const last = useRef<{ who: string; level: number } | null>(null);
  useEffect(() => {
    if (!lv) return;
    const prev = last.current;
    last.current = { who, level: lv.level };
    // the first reading is where you are, not a level-up; a switched account starts over
    if (account === undefined && prev && prev.who === who && lv.level > prev.level) {
      sfx("levelup");
      emitFx({ kind: "levelup", level: lv.level });
    }
  }, [lv?.level, who, account]);
  return lv;
}

/** The level and its XP bar, as a game's HUD shows it. */
export function LevelBar({ lv, compact }: { lv: Level | null; compact?: boolean }) {
  if (!lv) return null;
  const pct = Math.min(100, (lv.into / lv.span) * 100);
  return (
    <span className="level-hud num" title={`${lv.xp.toLocaleString("en-US")} XP: ${lv.span - lv.into} to level ${lv.level + 1}`}>
      <span className="level-badge display">LV {lv.level}</span>
      {!compact && (
        <span className="level-track" role="progressbar" aria-label={`Level ${lv.level}, ${Math.round(pct)}% to the next`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <span className="level-fill" style={{ width: `${pct}%` }} />
        </span>
      )}
      {!compact && <span className="level-xp">{lv.into}/{lv.span} XP</span>}
    </span>
  );
}
