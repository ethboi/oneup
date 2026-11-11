"use client";

// One Life NFT's own history, newest first: who it was minted to, every time it changed hands or sold, and its
// claims. Built from chain events by /api/life-history.

import { useEffect, useState } from "react";
import { displayAccount, fmtUsdc } from "@oneup/sdk";
import { useOneUp } from "@/lib/oneup";
import type { LifeItem } from "@/lib/server/activity";
import { Icon, type IconName } from "./Icon";
import { OnExplorer } from "./ui";

interface LifeHistory {
  items: LifeItem[];
  complete: boolean;
  synced: boolean;
}

export function useLifeHistory(tokenId: string) {
  const { d } = useOneUp();
  const [h, setH] = useState<LifeHistory | null>(null);
  useEffect(() => {
    let live = true;
    setH(null);
    const tick = () =>
      fetch(`/api/life-history?id=${encodeURIComponent(tokenId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => live && j && setH(j))
        .catch(() => {});
    tick();
    // testnet: published every 30 seconds
    const i = setInterval(tick, d.network === "localnet" ? 3000 : 20_000);
    return () => {
      live = false;
      clearInterval(i);
    };
  }, [tokenId, d.network]);
  return h;
}

const when = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** What one history entry says. Exported for tests. */
export function lifeRow(i: LifeItem, me: string): { icon: IconName; title: string; detail: string; amount?: string } {
  const who = (a: string) => (a === me ? "you" : displayAccount(a));
  switch (i.kind) {
    case "minted":
      return { icon: "heart", title: `Minted to ${who(i.owner)}`, detail: "Issued when the round closed" };
    case "transferred":
      return { icon: "merge", title: `Sent from ${who(i.from)} to ${who(i.to)}`, detail: "Its unclaimed USDC and later payouts went with it" };
    case "sold":
      return { icon: "cart", title: `Sold by ${who(i.from)} to ${who(i.to)}`, detail: "Through the market, with its unclaimed USDC", amount: `$${fmtUsdc(BigInt(i.price))}` };
    case "claimed":
      return i.lives > 1
        ? { icon: "claim", title: `Claimed by ${who(i.owner)}`, detail: `In one claim with ${i.lives - 1} other Li${i.lives === 2 ? "fe" : "ves"}: $${fmtUsdc(BigInt(i.amount))} in all` }
        : { icon: "claim", title: `Claimed by ${who(i.owner)}`, detail: "USDC sent to its owner", amount: `$${fmtUsdc(BigInt(i.amount))}` };
  }
}

export function LifeHistoryList({ tokenId }: { tokenId: string }) {
  const { me } = useOneUp();
  const h = useLifeHistory(tokenId);
  if (!h) return <p className="label py-2">Loading…</p>;
  return (
    <div>
      {!h.complete && <p className="label py-2">Older events for this Life are still being read from the chain, so this list may be incomplete.</p>}
      {h.items.length === 0 && <p className="label py-2">No events recorded for this Life yet.</p>}
      <ul className="flex flex-col">
        {h.items.map((i) => {
          const r = lifeRow(i, me);
          return (
            <li key={i.seq} className="num flex items-center gap-3 border-b border-[var(--line)] py-2.5 text-sm last:border-0">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--panel-2)] text-[var(--muted)]">
                <Icon name={r.icon} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{r.title}</span>
                <span className="label block truncate">
                  {when(i.t)} · {r.detail}
                </span>
              </span>
              {r.amount && <span className="font-extrabold">{r.amount}</span>}
              {i.tx && <OnExplorer tx={i.tx} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
