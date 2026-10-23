"use client";

// Your history, newest first: closed trades (each with a shareable card), deposits and withdrawals, claims,
// Extra Lives and locks you got, and market sales. Built from chain events by /api/history.

import { useEffect, useState } from "react";
import { OnExplorer } from "./ui";
import { fmtUsdc } from "@oneup/sdk";
import { useOneUp } from "@/lib/oneup";
import type { HistoryItem } from "@/lib/server/activity";
import { fmtOneup } from "./Header";
import { Icon, type IconName } from "./Icon";
import { ShareButton } from "./PnlCard";
import { fmtPrice } from "./Trade";

interface History {
  items: HistoryItem[];
  synced: boolean;
  progress: number;
}

export function useHistory(account: string) {
  const [h, setH] = useState<History | null>(null);
  useEffect(() => {
    let live = true;
    setH(null);
    const tick = () =>
      fetch(`/api/history?account=${encodeURIComponent(account)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => live && j && setH(j))
        .catch(() => {});
    tick();
    const i = setInterval(tick, 3000);
    return () => {
      live = false;
      clearInterval(i);
    };
  }, [account]);
  return h;
}

const REASON: Record<string, string> = {
  Close: "Closed",
  Liquidation: "Liquidated",
  TakeProfit: "Took profit at the cap",
  Target: "Take-profit hit",
  Stop: "Stop-loss hit",
};

const when = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const short = (a: string) => a.replace(/\.test\.near$/, "");

export function HistoryList() {
  const { me } = useOneUp();
  const h = useHistory(me);
  if (!h) return <p className="label py-2">Loading…</p>;
  return (
    <div>
      {!h.synced && (
        <p className="label flex items-center gap-2 py-2">
          <Icon name="spinner" /> Reading the chain… {Math.round(h.progress * 100)}%
        </p>
      )}
      {h.items.length === 0 && h.synced && <p className="label py-2">Nothing yet. Your trades, deposits and claims show up here.</p>}
      <ul className="flex flex-col">
        {h.items.slice(0, 100).map((i) => (
          <Row key={i.seq} i={i} me={me} />
        ))}
      </ul>
    </div>
  );
}

function Row({ i, me }: { i: HistoryItem; me: string }) {
  let icon: IconName = "info";
  let color = "var(--muted)";
  let title: React.ReactNode = null;
  let detail: React.ReactNode = null;
  let amount: React.ReactNode = null;
  let share: React.ReactNode = null;

  switch (i.kind) {
    case "trade": {
      const tr = i.trade;
      const pnl = BigInt(tr.pnl);
      const margin = BigInt(tr.margin);
      const up = pnl >= 0n;
      icon = up ? "up" : "down";
      color = up ? "var(--long)" : "var(--short)";
      title = (
        <>
          <span style={{ color: tr.side === "Long" ? "var(--long)" : "var(--short)" }}>{tr.side}</span> {tr.market_id} {tr.leverage}×
        </>
      );
      detail = `${REASON[tr.reason] ?? "Closed"} · ${fmtPrice(BigInt(tr.entry_price))} → ${fmtPrice(BigInt(tr.exit_price))}`;
      amount = (
        <span className="text-right" style={{ color }}>
          <span className="block font-extrabold">
            {up ? "+" : "−"}${fmtUsdc(up ? pnl : -pnl)}
          </span>
          <span className="label block">{margin > 0n ? `${up ? "+" : "−"}${Math.abs((Number(pnl) / Number(margin)) * 100).toFixed(1)}%` : ""}</span>
        </span>
      );
      share = (
        <ShareButton
          compact
          data={() => ({
            market: tr.market_id,
            side: tr.side,
            leverage: tr.leverage,
            margin,
            pnl,
            entry: BigInt(tr.entry_price),
            exit: BigInt(tr.exit_price),
            state: tr.reason === "Liquidation" ? "liquidated" : "closed",
            account: me,
          })}
        />
      );
      break;
    }
    case "deposit":
    case "withdraw":
      icon = i.kind;
      title = i.kind === "deposit" ? "Deposited" : "Withdrew";
      detail = i.kind === "deposit" ? "Wallet → trading balance" : "Trading balance → wallet";
      amount = <span className="font-extrabold">${fmtUsdc(BigInt(i.amount))}</span>;
      break;
    case "backed":
      icon = "deposit";
      title = "Backed the house";
      detail = `Backer Life owed ${(Number(i.cap_ppm) / 1e6).toFixed(2)}×`;
      amount = <span className="font-extrabold">${fmtUsdc(BigInt(i.amount))}</span>;
      break;
    case "jackpot":
      icon = "trophy";
      color = "var(--accent)";
      title = "Won the jackpot";
      detail = `With ${fmtUsdc(BigInt(i.tickets), 0)} tickets`;
      amount = <span className="font-extrabold text-[var(--long)]">+${fmtUsdc(BigInt(i.amount))}</span>;
      break;
    case "claim_usdc":
      icon = "claim";
      color = "var(--long)";
      title = "Claimed from Extra Lives";
      amount = <span className="font-extrabold text-[var(--long)]">+${fmtUsdc(BigInt(i.amount))}</span>;
      break;
    case "claim_oneup":
      icon = "claim";
      color = "var(--info)";
      title = "$1UP from your locks";
      detail = "A claim, an unlock or leaving early";
      amount = <span className="font-extrabold">+{fmtOneup(i.amount, 2)} $1UP</span>;
      break;
    case "life":
      icon = "heart";
      color = "var(--heart)";
      title = "Got an Extra Life";
      detail = `#${i.token_id}`;
      break;
    case "lock":
      icon = "lock";
      color = "var(--info)";
      title = "Got a $1UP lock";
      detail = `#${i.token_id}`;
      break;
    case "bought":
    case "sold":
      icon = i.kind === "bought" ? "cart" : "tag";
      color = "var(--primary)";
      title = i.kind === "bought" ? `Bought an ${i.what === "Extra Life" ? "Extra Life" : "$1UP lock"}` : `Sold an ${i.what === "Extra Life" ? "Extra Life" : "$1UP lock"}`;
      detail = `${i.kind === "bought" ? "from" : "to"} ${short(i.other)}`;
      amount = <span className="font-extrabold">{i.kind === "bought" ? "−" : "+"}${fmtUsdc(BigInt(i.price))}</span>;
      break;
  }

  return (
    <li className="num flex items-center gap-3 border-b border-[var(--line)] py-2.5 text-sm last:border-0">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--panel-2)]" style={{ color }}>
        <Icon name={icon} size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{title}</span>
        <span className="label block truncate">
          {when(i.t)}
          {detail ? ` · ${detail}` : ""}
        </span>
      </span>
      {amount}
      {share}
      {i.tx && <OnExplorer tx={i.tx} />}
    </li>
  );
}
