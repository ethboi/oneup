"use client";

// Live activity: what's happening on the exchange, from the contracts' events (/api/activity).

import { useEffect, useState } from "react";
import { pollActivity } from "../lib/activity-feed";
import { OnExplorer } from "./ui";
import { useNow } from "./Header";
import { Icon, type IconName } from "./Icon";

export interface ActivityItem {
  seq: number;
  t: number;
  kind: "liquidated" | "lost" | "won" | "opened" | "life" | "lock" | "epoch" | "sold" | "backed" | "jackpot";
  who?: string;
  text: string;
  /** On a sale: what sold, its price and (when seen live) its value then (lib/server/activity.ts). */
  sale?: { nft: "life" | "lock"; token_id: string; price: string; value?: string };
  amount?: string;
  /** On an open or a close: the trade, for the trades tape (lib/server/activity.ts). */
  trade?: { market: string; side: "Long" | "Short"; size: string; price: string; open: boolean };
  /** On a jackpot draw: its round and the winner's tickets out of all of them (lib/server/activity.ts). */
  draw?: { epoch: number; tickets?: string; total?: string };
  /** The transaction the event came from (lib/explorer.ts links it on testnet and mainnet). */
  tx?: string;
}

const LOOK: Record<ActivityItem["kind"], { icon: IconName; color: string }> = {
  liquidated: { icon: "x", color: "var(--short)" },
  lost: { icon: "down", color: "var(--short)" },
  won: { icon: "up", color: "var(--long)" },
  opened: { icon: "chart", color: "var(--muted)" },
  life: { icon: "heart", color: "var(--heart)" },
  lock: { icon: "lock", color: "var(--info)" },
  epoch: { icon: "shield", color: "var(--text)" },
  sold: { icon: "cart", color: "var(--primary)" },
  backed: { icon: "shield", color: "var(--info)" },
  jackpot: { icon: "trophy", color: "var(--accent)" },
};

/** Polls the feed and keeps the newest `keep` items, newest first. */
export function useActivity(keep = 60): ActivityItem[] {
  const [items, setItems] = useState<ActivityItem[]>([]);
  useEffect(() => {
    setItems([]);
    return pollActivity<ActivityItem>(async after => {
      const response = await fetch(`/api/activity?after=${after}`);
      if (!response.ok) throw new Error("Activity unavailable");
      return (await response.json()).items ?? [];
    }, setItems, keep);
  }, [keep]);
  return items;
}

const ago = (now: number, t: number) => {
  const s = Math.max(0, Math.round(now - t / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};

export function ActivityList({ items, limit = 8, empty = "Waiting for activity…" }: { items: ActivityItem[]; limit?: number; empty?: string }) {
  const now = useNow();
  if (items.length === 0) return <p className="label">{empty}</p>;
  return (
    <ul className="flex flex-col">
      {items.slice(0, limit).map((a) => (
        <li key={a.seq} className="flex items-center gap-2.5 border-b border-[var(--line)] py-2 text-sm last:border-0">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--panel-2)]" style={{ color: LOOK[a.kind].color }}>
            <Icon name={LOOK[a.kind].icon} size={15} />
          </span>
          <span className="min-w-0 flex-1 leading-snug">{a.text}</span>
          <span className="label num shrink-0">{ago(now, a.t)}</span>
          {a.tx && <OnExplorer tx={a.tx} />}
        </li>
      ))}
    </ul>
  );
}
