"use client";

// The jackpot (D-27): the interest the house's idle pool earns, drawn every few rounds among that period's
// losers, a ticket for each dollar of net loss.

import { useEffect, useState } from "react";
import { USDC, fmtUsdc } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import type { ActivityItem } from "./Activity";
import { PixelAmount, PixelCoin } from "./Pixel";
import { useNow } from "./Header";

/** Every jackpot draw so far, newest first (/api/jackpots). */
function useDraws(): ActivityItem[] | null {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  useEffect(() => {
    let live = true;
    const tick = () =>
      fetch("/api/jackpots")
        .then((x) => (x.ok ? x.json() : { items: [] }))
        .then((j) => live && setItems(j.items ?? []))
        .catch(() => {});
    tick();
    const i = setInterval(tick, 15_000);
    return () => {
      live = false;
      clearInterval(i);
    };
  }, []);
  return items;
}

const money = (x: bigint) => `$${fmtUsdc(x, x < 1_000n * USDC ? 2 : 0)}`;

/** 3d 4h, 2h 05m, 31:20. */
export function fmtDuration(s: number) {
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Jackpot({ compact }: { compact?: boolean }) {
  const { o, d, me } = useOneUp();
  const now = useNow();
  const t = usePoll(() => o.treasury(), [], 5000);
  const epoch = usePoll(() => o.epoch(), [], 10_000);
  const mine = usePoll(() => o.tickets(me), [me], 5000);
  const pending = usePoll(() => o.pendingLife(me), [me], 5000);
  const draws = useDraws();
  if (!t || !t.vault) return null;

  const pot = BigInt(t.jackpot);
  const total = BigInt(t.tickets);
  // this round's net loss turns into tickets when the round closes
  const myTickets = BigInt(mine ?? "0") + BigInt(pending ?? "0");
  // the draw happens when round `draw_epoch` closes
  const left = epoch ? Math.max(0, (t.draw_epoch - epoch.id) * d.epochLengthS + epoch.started_at + d.epochLengthS - now) : null;
  const odds = total + BigInt(pending ?? "0") > 0n ? (Number(myTickets) / Number(total + BigInt(pending ?? "0"))) * 100 : 0;

  return (
    <div className={`panel panel-jackpot ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-center gap-2">
        <PixelCoin size={22} />
        <h2 className="font-extrabold">Jackpot</h2>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="bezel rounded-xl px-3 py-2">
          <div className="lcd rounded-lg px-3 py-2">
            <PixelAmount text={`$${fmtUsdc(pot, pot < 1_000n * USDC ? 2 : 0)}`} height={compact ? 30 : 40} />
          </div>
        </div>
        <dl className="num grid flex-1 basis-full grid-cols-3 gap-4 sm:basis-auto sm:min-w-[320px]">
          <div>
            <dt className="label">Next draw</dt>
            <dd className="text-xl font-extrabold">{left === null ? "…" : fmtDuration(left)}</dd>
          </div>
          <div>
            <dt className="label">Your tickets</dt>
            <dd className="text-xl font-extrabold">{fmtUsdc(myTickets, 0)}</dd>
          </div>
          <div>
            <dt className="label">Current odds</dt>
            <dd className="text-xl font-extrabold">{myTickets > 0n ? `${odds.toFixed(odds < 1 ? 2 : 1)}%` : "–"}</dd>
          </div>
        </dl>
      </div>
      <p className="label mt-3">
        The demo jackpot is funded by simulated vault interest. Each $1 of eligible net loss adds a ticket. One winning ticket receives the full prize.
        {myTickets === 0n && " You have no tickets for this draw."}
      </p>
      {compact ? <LastWinner draws={draws} me={me} /> : <PastDraws draws={draws} me={me} />}
    </div>
  );
}

const shortName = (a?: string) => a?.replace(/\.test\.near$/, "") ?? "";

/** The side column's version: who took the last pot. */
function LastWinner({ draws, me }: { draws: ActivityItem[] | null; me: string }) {
  const last = draws?.find((d) => d.who);
  if (!last) return null;
  const you = last.who === shortName(me);
  return (
    <p className="num mt-2 border-t border-[var(--line)] pt-2 text-sm">
      <span className="label">Last won by </span>
      <b>{you ? "you" : last.who}</b>
      <span className="label"> · </span>
      <b style={{ color: "var(--jackpot)" }}>{money(BigInt(last.amount ?? "0"))}</b>
      <span className="label"> · round {last.draw?.epoch}</span>
    </p>
  );
}

/** Every draw: the round, who won, the pot and the odds they had, or that it rolled over. */
function PastDraws({ draws, me }: { draws: ActivityItem[] | null; me: string }) {
  const [all, setAll] = useState(false);
  if (!draws) return null;
  const shown = all ? draws : draws.slice(0, 6);
  return (
    <div className="mt-4 border-t border-[var(--line)] pt-3">
      <h3 className="font-extrabold">Past draws</h3>
      {draws.length === 0 ? (
        <p className="label mt-1">No draws yet. The countdown shows when the first draw is due.</p>
      ) : (
        <table className="num mt-2 w-full text-sm">
          <thead>
            <tr className="label text-left">
              <th className="pb-1.5 font-normal">Round</th>
              <th className="pb-1.5 font-normal">Winner</th>
              <th className="pb-1.5 text-right font-normal">Pot</th>
              <th className="hidden pb-1.5 text-right font-normal sm:table-cell">Winning account’s tickets</th>
              <th className="pb-1.5 text-right font-normal">Odds</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => {
              const you = d.who === shortName(me);
              const tickets = d.draw?.tickets ? BigInt(d.draw.tickets) : null;
              const total = d.draw?.total ? BigInt(d.draw.total) : null;
              const odds = tickets !== null && total ? (Number(tickets) / Number(total)) * 100 : null;
              return (
                <tr key={d.seq} className="border-t border-[var(--line)]" style={you ? { background: "color-mix(in srgb, var(--primary) 9%, transparent)" } : undefined}>
                  <td className="py-2">{d.draw?.epoch}</td>
                  <td className="py-2">
                    {d.who ? (
                      <>
                        <b>{d.who}</b>
                        {you && <span className="you-tag">you</span>}
                      </>
                    ) : (
                      <span className="label">No tickets: rolled over</span>
                    )}
                  </td>
                  <td className="py-2 text-right font-bold" style={d.who ? { color: "var(--jackpot)" } : { color: "var(--muted)" }}>
                    {money(BigInt(d.amount ?? "0"))}
                  </td>
                  <td className="hidden py-2 text-right sm:table-cell">{tickets === null ? "–" : `${fmtUsdc(tickets, 0)} of ${fmtUsdc(total ?? 0n, 0)}`}</td>
                  <td className="py-2 text-right">{odds === null ? "–" : `${odds.toFixed(odds < 1 ? 2 : 1)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {draws.length > 6 && (
        <button type="button" className="label mt-2 font-bold underline decoration-dotted underline-offset-2" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${draws.length}`}
        </button>
      )}
    </div>
  );
}
