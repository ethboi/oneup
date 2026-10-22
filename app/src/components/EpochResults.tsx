"use client";

// "Round over": when an epoch closes, a results screen: the house's result, the Extra Lives it minted, how
// you did, and the epoch's leaderboard (top traders, the best trade, the biggest loss). Shown once per epoch
// while the app is open; it can be turned off from the screen itself.

import { useEffect, useRef, useState } from "react";
import { fmtUsdc, type EpochSummary } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { sfx } from "@/lib/sound";
import type { Board } from "@/lib/server/activity";
import { useHistory } from "./History";
import { PixelHeart } from "./Pixel";
import { Icon } from "./Icon";

const OFF = "oneup.rounds.off";
const short = (a: string) => a.replace(/\.test\.near$/, "");
const signed = (x: bigint) => `${x >= 0n ? "+" : "−"}$${fmtUsdc(x < 0n ? -x : x)}`;

export function EpochResults() {
  const { o, me } = useOneUp();
  const epoch = usePoll(() => o.epoch(), []);
  const last = useRef<number | null>(null);
  const [round, setRound] = useState<{ s: EpochSummary; board: Board | null } | null>(null);
  const history = useHistory(me);
  // the epoch poll re-runs the effect every 2 s, so loading a round is cancelled only on unmount
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!epoch) return;
    const prev = last.current;
    last.current = epoch.id;
    if (prev === null || epoch.id <= prev) return;
    try {
      if (localStorage.getItem(OFF) === "1") return;
    } catch {}
    (async () => {
      // the summary lands with the close; give the indexer a few seconds to catch the last trades
      let s: EpochSummary | null = null;
      for (let i = 0; i < 10 && !s; i++) {
        s = await o.epochSummary(epoch.id - 1).catch(() => null);
        if (!s) await new Promise((r) => setTimeout(r, 1500));
      }
      if (!s || !mounted.current) return;
      await new Promise((r) => setTimeout(r, 6000));
      const board = await fetch(`/api/leaderboard?from=${s.started_at * 1000}&to=${s.ended_at * 1000}`)
        .then((r) => (r.ok ? (r.json() as Promise<Board>) : null))
        .catch(() => null);
      if (!mounted.current) return;
      sfx("round");
      setRound({ s, board });
    })();
  }, [epoch, o]);

  useEffect(() => {
    if (!round) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setRound(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [round]);

  if (!round) return null;
  const { s, board } = round;
  const net = BigInt(s.house_net);
  const mine = (history?.items ?? []).filter((i) => i.kind === "trade" && i.t >= s.started_at * 1000 && i.t <= s.ended_at * 1000);
  const myPnl = mine.reduce((a, i) => a + (i.kind === "trade" ? BigInt(i.trade.pnl) : 0n), 0n);
  const lost = myPnl < 0n;

  return (
    <div className="fixed inset-0 z-[62] flex items-center justify-center bg-black/55 p-4" onMouseDown={(e) => e.target === e.currentTarget && setRound(null)}>
      <div role="dialog" aria-label={`Round ${s.epoch} results`} className="case round-in relative flex max-h-[92vh] w-full max-w-[560px] flex-col gap-4 overflow-y-auto p-5 sm:p-6">
        <div className="bezel p-4">
          <div className="lcd px-4 py-3 text-[var(--lcd-ink)]">
            <div className="display text-sm">ROUND {s.epoch}</div>
            <div className="display text-4xl leading-tight">ROUND OVER</div>
            <div className="display num mt-1 text-base">
              {net > 0n ? `HOUSE +$${fmtUsdc(net, 0)} · ${s.lives_minted} EXTRA LIVES` : "HOUSE DIDN'T PROFIT · NO LIVES"}
            </div>
          </div>
        </div>

        <section className="flex items-center gap-3">
          {lost ? <PixelHeart size={36} /> : <Icon name={mine.length ? "up" : "chart"} size={28} />}
          <div className="min-w-0 flex-1">
            <div className="label">You this round</div>
            <div className="num text-xl font-extrabold" style={{ color: mine.length ? (lost ? "var(--short)" : "var(--long)") : undefined }}>
              {mine.length ? `${signed(myPnl)} on ${mine.length} trade${mine.length === 1 ? "" : "s"}` : "Sat this one out"}
            </div>
            {lost && net > 0n && <div className="label">Your Extra Life is minting now. Check Extra Lives.</div>}
            {lost && net === 0n && <div className="label">The house didn&apos;t profit, so no lives this time.</div>}
          </div>
        </section>

        <section className="grid grid-cols-3 gap-3 border-y border-[var(--line)] py-3 text-sm">
          <div>
            <div className="label">Traders lost</div>
            <div className="num font-extrabold">${fmtUsdc(BigInt(s.losses), 0)}</div>
          </div>
          <div>
            <div className="label">Paid to lives</div>
            <div className="num font-extrabold">${fmtUsdc(BigInt(s.lives_pot), 0)}</div>
          </div>
          <div>
            <div className="label">Buyback</div>
            <div className="num font-extrabold">${fmtUsdc(BigInt(s.buyback_pot), 0)}</div>
          </div>
        </section>

        {board && board.top.length > 0 && (
          <section>
            <h3 className="font-extrabold">Leaderboard</h3>
            <ol className="mt-2 flex flex-col">
              {board.top.map((r, i) => (
                <li key={r.account} className="num flex items-center gap-3 border-b border-[var(--line)] py-1.5 text-sm last:border-0" style={r.account === me ? { fontWeight: 800 } : undefined}>
                  <span className="display w-6 text-[var(--muted)]">{i + 1}</span>
                  <span className="flex-1">{short(r.account)}{r.account === me ? " (you)" : ""}</span>
                  <span className="label">
                    {r.trades} trade{r.trades === 1 ? "" : "s"}
                  </span>
                  <span className="w-24 text-right" style={{ color: BigInt(r.pnl) >= 0n ? "var(--long)" : "var(--short)" }}>
                    {signed(BigInt(r.pnl))}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {board.best && (
                <div className="rounded-lg bg-[var(--panel-2)] p-2.5">
                  <div className="label">Best trade</div>
                  <b>{short(board.best.account)}</b>{" "}
                  <span className="num">
                    {board.best.side} {board.best.market_id} {board.best.leverage}×, {Math.round((Number(board.best.pnl) / Number(board.best.margin)) * 100)}%
                  </span>
                </div>
              )}
              {board.biggestLoss && (
                <div className="rounded-lg bg-[var(--panel-2)] p-2.5">
                  <div className="label">{net > 0n ? "Biggest loss (biggest life on its way)" : "Biggest loss"}</div>
                  <b>{short(board.biggestLoss.account)}</b> <span className="num">{signed(BigInt(board.biggestLoss.pnl))}</span>
                </div>
              )}
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            className="label underline decoration-dotted underline-offset-2"
            onClick={() => {
              try {
                localStorage.setItem(OFF, "1");
              } catch {}
              setRound(null);
            }}
          >
            Don&apos;t show round results
          </button>
          <button className="btn btn-accent" onClick={() => setRound(null)}>
            Next round
          </button>
        </div>
      </div>
    </div>
  );
}
