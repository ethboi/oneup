"use client";

// Achievements: a watcher that pops "Achievement unlocked" when you earn a badge (the first visit only
// records what you already have), the badge dialog (opened from the account menu) and the console skins
// they unlock.

import { useEffect, useState } from "react";
import { useOneUp, usePoll } from "@/lib/oneup";
import { ACHIEVEMENTS, GROUPS, SKINS, badgeStates, readFlags, skinUnlocked, type BadgeState, type Rarity } from "@/lib/achievements";
import { sfx } from "@/lib/sound";
import { useHistory } from "./History";
import { Icon } from "./Icon";

/** Each badge's state for this account (earned, when, progress), once its history has loaded. */
export function useBadgeStates(): Map<string, BadgeState> | null {
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
  return badgeStates(history.items, lives, locks, flags);
}

/** The badges this account has, once its history has loaded. */
export function useBadges(): Set<string> | null {
  const states = useBadgeStates();
  if (!states) return null;
  return new Set([...states].filter(([, b]) => b.got).map(([id]) => id));
}

/** Each rarity's colour and name. */
export const RARITY: Record<Rarity, { color: string; name: string }> = {
  common: { color: "var(--long)", name: "Common" },
  rare: { color: "var(--info)", name: "Rare" },
  epic: { color: "var(--heart)", name: "Epic" },
  legendary: { color: "var(--accent)", name: "Legendary" },
};

const when = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

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
      <span className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--on-color)]" style={{ background: RARITY[a.rarity].color }}>
        <Icon name="trophy" size={20} />
      </span>
      <span>
        <span className="label block">Achievement unlocked · {RARITY[a.rarity].name}</span>
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
  const states = useBadgeStates();
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
        <div className="flex flex-wrap gap-3 text-sm">
          {(Object.keys(RARITY) as Rarity[]).map((r) => {
            const all = ACHIEVEMENTS.filter((a) => a.rarity === r);
            return (
              <span key={r} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: RARITY[r].color }} />
                {RARITY[r].name} <span className="label num">{all.filter((a) => have?.has(a.id)).length}/{all.length}</span>
              </span>
            );
          })}
        </div>
        {GROUPS.map((g) => (
          <section key={g}>
            <h3 className="mb-2 font-extrabold">{g}</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {ACHIEVEMENTS.filter((a) => a.group === g).map((a) => (
                <Badge key={a.id} a={a} b={states?.get(a.id)} />
              ))}
            </ul>
          </section>
        ))}
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

function Badge({ a, b }: { a: (typeof ACHIEVEMENTS)[number]; b?: BadgeState }) {
  const got = !!b?.got;
  const r = RARITY[a.rarity];
  return (
    <li
      className="flex gap-3 rounded-lg border p-3"
      style={{ borderColor: got ? r.color : "var(--line)", background: got ? `color-mix(in srgb, ${r.color} 7%, transparent)` : undefined }}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ background: got ? r.color : "var(--panel-2)", color: got ? "var(--on-color)" : "var(--muted)" }}
      >
        <Icon name={got ? "trophy" : "lock"} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <b className={got ? "" : "text-[var(--muted)]"}>{a.name}</b>
          <span className="shrink-0 text-xs font-bold" style={{ color: r.color }}>
            {r.name}
          </span>
        </span>
        <span className="block text-sm">{a.how}</span>
        <span className="label block">{a.detail}</span>
        {got ? (
          b?.at && <span className="label num mt-1 block">Earned {when(b.at)}</span>
        ) : (
          b?.progress && (
            <span className="mt-1.5 flex items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
                <span className="block h-full rounded-full" style={{ width: `${(b.progress.n / b.progress.of) * 100}%`, background: r.color }} />
              </span>
              <span className="label num">
                {b.progress.n}/{b.progress.of}
              </span>
            </span>
          )
        )}
      </span>
    </li>
  );
}
