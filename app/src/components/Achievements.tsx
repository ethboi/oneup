"use client";

// Achievements: a watcher that pops "Achievement unlocked" when you earn a badge (the first visit only
// records what you already have), the badge dialog (opened from the account menu) and the console skins
// they unlock.

import { useEffect, useState } from "react";
import { useOneUp, usePoll } from "@/lib/oneup";
import { ACHIEVEMENTS, SKINS, earned, readFlags, skinUnlocked } from "@/lib/achievements";
import { sfx } from "@/lib/sound";
import { useHistory } from "./History";
import { Icon } from "./Icon";

/** The badges this account has, once its history has loaded. */
export function useBadges(): Set<string> | null {
  const { o, me } = useOneUp();
  const history = useHistory(me);
  const lives = usePoll(() => o.lives(me), [me], 5000);
  const locks = usePoll(() => o.locks(me), [me], 5000);
  const [flags, setFlags] = useState<Set<string>>(new Set());
  useEffect(() => {
    const read = () => setFlags(readFlags(me));
    read();
    window.addEventListener("oneup-flags", read);
    return () => window.removeEventListener("oneup-flags", read);
  }, [me]);
  if (!history?.synced || !lives || !locks) return null;
  return earned(history.items, lives, locks, flags);
}

const seenKey = (account: string) => `oneup.badges.${account}`;

export function AchievementWatcher() {
  const { me } = useOneUp();
  const have = useBadges();
  const [shown, setShown] = useState<{ id: string; at: number } | null>(null);
  const list = have ? [...have].sort().join() : null;

  useEffect(() => {
    if (!have) return;
    let seen: string[] | null = null;
    try {
      seen = JSON.parse(localStorage.getItem(seenKey(me)) ?? "null");
    } catch {}
    try {
      localStorage.setItem(seenKey(me), JSON.stringify([...have]));
    } catch {}
    if (seen === null) return; // first look at this account: what it already has isn't news
    const fresh = [...have].filter((id) => !seen!.includes(id));
    if (fresh.length === 0) return;
    sfx("badge");
    setShown({ id: fresh[0], at: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, me]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 4500);
    return () => clearTimeout(t);
  }, [shown]);

  const a = shown && ACHIEVEMENTS.find((x) => x.id === shown.id);
  if (!a) return null;
  return (
    <button
      key={shown.at}
      className="badge-toast panel fixed left-1/2 top-4 z-[70] flex -translate-x-1/2 items-center gap-3 px-4 py-3 text-left"
      onClick={() => (setShown(null), openBadges())}
      role="status"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--on-color)]">
        <Icon name="trophy" size={20} />
      </span>
      <span>
        <span className="label block">Achievement unlocked</span>
        <b className="block">{a.name}</b>
        <span className="label block">{a.how}</span>
      </span>
    </button>
  );
}

export const openBadges = () => window.dispatchEvent(new Event("oneup-open-badges"));

/** Applies the chosen console skin (remembered in this browser). */
export function useSkin(): [string, (s: string) => void] {
  const [skin, set] = useState("classic");
  useEffect(() => {
    try {
      set(localStorage.getItem("oneup.skin") ?? "classic");
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.dataset.skin = skin;
  }, [skin]);
  return [
    skin,
    (s: string) => {
      set(s);
      try {
        localStorage.setItem("oneup.skin", s);
      } catch {}
    },
  ];
}

export function BadgesDialog() {
  const [open, setOpen] = useState(false);
  const have = useBadges();
  const [skin, setSkin] = useSkin();
  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("oneup-open-badges", show);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("oneup-open-badges", show);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  // a skin that isn't unlocked for this account falls back to Classic
  useEffect(() => {
    const s = SKINS.find((x) => x.id === skin);
    if (have && s && !skinUnlocked(s, have)) setSkin("classic");
  }, [have, skin, setSkin]);
  if (!open) return null;
  const n = have?.size ?? 0;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-label="Achievements" className="panel flex max-h-[90vh] w-full max-w-[680px] flex-col gap-4 overflow-y-auto p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold">
            Achievements <span className="label num">{have ? `${n} of ${ACHIEVEMENTS.length}` : "…"}</span>
          </h2>
          <button className="btn btn-ghost px-2.5" onClick={() => setOpen(false)} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {ACHIEVEMENTS.map((a) => {
            const got = have?.has(a.id);
            return (
              <li key={a.id} className="flex items-center gap-3 rounded-lg border border-[var(--line)] p-3" style={got ? undefined : { opacity: 0.55 }}>
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{ background: got ? "var(--accent)" : "var(--panel-2)", color: got ? "var(--on-color)" : "var(--muted)" }}
                >
                  <Icon name={got ? "trophy" : "lock"} size={17} />
                </span>
                <span className="min-w-0">
                  <b className="block">{a.name}</b>
                  <span className="label block">{a.how}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <div>
          <h3 className="font-extrabold">Console skins</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {SKINS.map((s) => {
              const ok = !!have && skinUnlocked(s, have);
              const need = !s.unlock ? "" : "badge" in s.unlock ? ACHIEVEMENTS.find((a) => a.id === (s.unlock as { badge: string }).badge)!.name : `${s.unlock.count} badges`;
              return (
                <button
                  key={s.id}
                  className="skin-swatch"
                  data-swatch={s.id}
                  aria-pressed={skin === s.id}
                  disabled={!ok}
                  onClick={() => setSkin(s.id)}
                  title={ok ? s.name : `Unlock with ${need}`}
                >
                  <span className="skin-chip" aria-hidden />
                  <span className="text-sm font-bold">{s.name}</span>
                  {!ok && <span className="label">{need}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
