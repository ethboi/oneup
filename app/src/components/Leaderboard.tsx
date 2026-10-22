"use client";

// Who's up and who's down: every trader's profit after the winner's cut over a round, a day or all time. The
// biggest losers get the biggest Extra Lives, so they have a board too.

import { useEffect, useState } from "react";
import { USDC, fmtUsdc } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import type { Standing } from "@/lib/server/activity";
import { PixelCoin, PixelHeart } from "./Pixel";
import { Jackpot } from "./Jackpot";

type Period = "round" | "day" | "all";

const short = (a: string) => a.replace(/\.test\.near$/, "");
const usd = (x: bigint) => `${x < 0n ? "−" : x > 0n ? "+" : ""}$${fmtUsdc(x < 0n ? -x : x, (x < 0n ? -x : x) < 1_000n * USDC ? 2 : 0)}`;

export function Leaderboard() {
  const { o, me } = useOneUp();
  const epoch = usePoll(() => o.epoch(), [], 10_000);
  const [period, setPeriod] = useState<Period>("day");
  const [data, setData] = useState<{ rows: Standing[]; synced: boolean } | null>(null);
  const from = period === "round" ? (epoch ? epoch.started_at * 1000 : null) : period === "day" ? Date.now() - 86_400_000 : 0;

  useEffect(() => {
    if (from === null) return;
    let live = true;
    const tick = () =>
      fetch(`/api/standings?from=${from}&to=${Date.now()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => live && j && setData(j))
        .catch(() => {});
    tick();
    const i = setInterval(tick, 5000);
    return () => {
      live = false;
      clearInterval(i);
    };
    // a new round or period refetches; `from` for "day" moves every render, so key it by period
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, epoch?.id]);

  const rows = data?.rows ?? [];
  const winners = rows.filter((r) => BigInt(r.pnl) > 0n);
  const losers = rows.filter((r) => BigInt(r.pnl) < 0n).reverse();
  const myRank = rows.findIndex((r) => r.account === me);
  const mine = myRank >= 0 ? rows[myRank] : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Leaderboard</h1>
          <p className="label">Profit after the winner&apos;s cut, from every closed trade.</p>
        </div>
        <div className="chip-track" role="group" aria-label="Period">
          {(
            [
              ["round", `Round ${epoch?.id ?? ""}`],
              ["day", "24 hours"],
              ["all", "All time"],
            ] as const
          ).map(([k, name]) => (
            <button key={k} type="button" className="chip num" aria-pressed={period === k} onClick={() => setPeriod(k)}>
              {name}
            </button>
          ))}
        </div>
      </div>

      <Jackpot />

      {mine && (
        <div className="panel num flex flex-wrap items-center gap-x-6 gap-y-1 p-4 text-sm">
          <b>You</b>
          <span>
            Rank <b>{myRank + 1}</b> <span className="label">of {rows.length}</span>
          </span>
          <span style={{ color: BigInt(mine.pnl) >= 0n ? "var(--long)" : "var(--short)" }}>
            <b>{usd(BigInt(mine.pnl))}</b>
          </span>
          <span>
            {mine.trades} trade{mine.trades === 1 ? "" : "s"} <span className="label">· {Math.round((mine.wins / mine.trades) * 100)}% won</span>
          </span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Board
          title="Top profit"
          icon={<PixelCoin size={20} />}
          rows={winners}
          me={me}
          empty={data === null ? "Loading…" : "Nobody's in profit over this period yet."}
        />
        <Board
          title="Most lost"
          note="The biggest losers get the biggest Extra Lives."
          icon={<PixelHeart size={20} />}
          rows={losers}
          me={me}
          empty={data === null ? "Loading…" : "Nobody's down over this period."}
        />
      </div>
      {data && !data.synced && <p className="label">Still reading the chain&apos;s history; older trades are on their way.</p>}
    </div>
  );
}

function Board({ title, note, icon, rows, me, empty }: { title: string; note?: string; icon: React.ReactNode; rows: Standing[]; me: string; empty: string }) {
  return (
    <section className="panel p-4">
      <h2 className="flex items-center gap-2 text-lg font-extrabold">
        {icon}
        {title}
      </h2>
      {note && <p className="label">{note}</p>}
      {rows.length === 0 ? (
        <p className="label mt-3">{empty}</p>
      ) : (
        <table className="num mt-3 w-full text-sm">
          <thead>
            <tr className="label text-left">
              <th className="w-8 pb-1.5 font-normal">#</th>
              <th className="pb-1.5 font-normal">Trader</th>
              <th className="pb-1.5 text-right font-normal">PnL</th>
              <th className="hidden pb-1.5 text-right font-normal sm:table-cell">Trades</th>
              <th className="pb-1.5 text-right font-normal">Won</th>
              <th className="hidden pb-1.5 text-right font-normal sm:table-cell">Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 15).map((r, i) => {
              const pnl = BigInt(r.pnl);
              const you = r.account === me;
              return (
                <tr key={r.account} className="border-t border-[var(--line)]" style={you ? { background: "var(--panel-2)" } : undefined}>
                  <td className="py-2 font-bold">{i + 1}</td>
                  <td className="py-2">
                    {short(r.account)}
                    {you && <span className="label"> (you)</span>}
                    {r.liquidations > 0 && <span className="label" title={`${r.liquidations} liquidated`}> · {r.liquidations}× rekt</span>}
                  </td>
                  <td className="py-2 text-right font-bold" style={{ color: pnl >= 0n ? "var(--long)" : "var(--short)" }}>
                    {usd(pnl)}
                  </td>
                  <td className="hidden py-2 text-right sm:table-cell">{r.trades}</td>
                  <td className="py-2 text-right">{Math.round((r.wins / r.trades) * 100)}%</td>
                  <td className="hidden py-2 text-right sm:table-cell">${fmtUsdc(BigInt(r.volume), 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
