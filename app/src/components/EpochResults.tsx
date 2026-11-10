"use client";

// "Round over": when an epoch closes, a card in the trading screen's notice slot (components/Trade.tsx), not a popup:
// the house's result and the Life NFTs it minted, how you did, and, behind Details, the round's numbers and
// leaderboard. Trading stays usable around it. Shown once per epoch while Trade is open, not to automated browsers,
// and not at all with "Show results after each round" off (the account menu).

import { useEffect, useRef, useState } from "react";
import { fmtUsdc, houseResult, type EpochSummary } from "@oneup/sdk";
import { automated } from "@/lib/automation";
import { useOneUp, usePoll } from "@/lib/oneup";
import { sfx } from "@/lib/sound";
import type { Board } from "@/lib/server/activity";
import { useHistory } from "./History";
import { PixelHeart } from "./Pixel";
import { Icon } from "./Icon";

const OFF = "oneup.rounds.off";
/** "bot1.v5.oneupmarkets.testnet" → "bot1"; a 64-character implicit account → its ends. */
const short = (a: string) => (/^[0-9a-f]{64}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a.split(".")[0]);
const signed = (x: bigint) => `${x >= 0n ? "+" : "−"}$${fmtUsdc(x < 0n ? -x : x)}`;

export function EpochResults() {
  const { o, me, d } = useOneUp();
  const epoch = usePoll(() => o.epoch(), []);
  const last = useRef<number | null>(null);
  const [round, setRound] = useState<{ s: EpochSummary; board: Board | null } | null>(null);
  const [details, setDetails] = useState(false);
  const history = useHistory(me);
  // leaving Trade unmounts this: a summary still loading then never shows
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const show = (s: EpochSummary, board: Board | null) => {
    sfx("round");
    setDetails(false);
    setRound({ s, board });
  };
  const leaderboard = (s: EpochSummary) =>
    fetch(`/api/leaderboard?from=${s.started_at * 1000}&to=${s.ended_at * 1000}`)
      .then((r) => (r.ok ? (r.json() as Promise<Board>) : null))
      .catch(() => null);

  useEffect(() => {
    if (!epoch) return;
    const prev = last.current;
    last.current = epoch.id;
    if (prev === null || epoch.id <= prev || automated()) return;
    try {
      if (localStorage.getItem(OFF) === "1") return;
    } catch {}
    (async () => {
      // the summary lands with the close; give the indexer a few seconds to catch the last trades
      let s: EpochSummary | null = null;
      for (let i = 0; i < 10 && !s && mounted.current; i++) {
        s = await o.epochSummary(epoch.id - 1).catch(() => null);
        if (!s) await new Promise((r) => setTimeout(r, 1500));
      }
      if (!s || !mounted.current) return;
      // testnet: the indexer reads a round's trades a little behind the chain
      await new Promise((r) => setTimeout(r, d.network === "localnet" ? 6000 : 75_000));
      if (!mounted.current) return;
      const board = await leaderboard(s);
      if (mounted.current) show(s, board);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, o, d.network]);

  // the Demo menu's preview: the last finished round's card, now
  useEffect(() => {
    if (d.network !== "localnet") return;
    const preview = async () => {
      if (!epoch || epoch.id < 2) return;
      const s = await o.epochSummary(epoch.id - 1).catch(() => null);
      if (s && mounted.current) show(s, await leaderboard(s));
    };
    window.addEventListener("oneup-preview-round", preview);
    return () => window.removeEventListener("oneup-preview-round", preview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, o, d.network]);

  if (!round) return null;
  const { s, board } = round;
  // the profit Life NFTs are sized from (zero in a losing round), and the round's real result
  const net = BigInt(s.house_net);
  const result = houseResult(s);
  const mine = (history?.items ?? []).filter((i) => i.kind === "trade" && i.t >= s.started_at * 1000 && i.t <= s.ended_at * 1000);
  const myPnl = mine.reduce((a, i) => a + (i.kind === "trade" ? BigInt(i.trade.pnl) - BigInt(i.trade.cut ?? 0) : 0n), 0n);
  const lost = myPnl < 0n;

  return (
    <section className="panel round-in flex flex-col gap-3 p-3 sm:p-4" aria-label={`Round ${s.epoch} results`} role="status">
      <div className="flex items-start gap-3">
        <div className="lcd min-w-0 flex-1 px-3 py-2 text-[var(--lcd-ink)] sm:flex-none sm:pr-6">
          <div className="display text-lg leading-tight sm:text-xl">ROUND {s.epoch} OVER</div>
          <div className="display num text-xs sm:text-sm">
            {net > 0n ? `HOUSE +$${fmtUsdc(net, 0)} · ${s.lives_minted} LIFE NFT${s.lives_minted === 1 ? "" : "S"}` : result < 0n ? `HOUSE −$${fmtUsdc(-result, 0)} · NO NEW LIFE NFTS` : "NO HOUSE PROFIT · NO NEW LIFE NFTS"}
          </div>
        </div>
        <button className="btn btn-ghost ml-auto shrink-0 px-2.5" onClick={() => setRound(null)} aria-label="Dismiss round results">
          <Icon name="x" />
        </button>
      </div>

      <div className="flex items-center gap-3">
        {lost ? <PixelHeart size={28} /> : <Icon name={mine.length ? "up" : "chart"} size={22} />}
        <div className="min-w-0 flex-1">
          <div className="num font-extrabold" style={{ color: mine.length ? (lost ? "var(--short)" : "var(--long)") : undefined }}>
            {mine.length ? `You: ${signed(myPnl)} on ${mine.length} trade${mine.length === 1 ? "" : "s"}` : "You didn't close a trade this round"}
          </div>
          {lost && net > 0n && <div className="label">The house made a profit, so your net loss may have earned a Life NFT. Check Life NFTs.</div>}
          {lost && net === 0n && <div className="label">The house {result < 0n ? "lost money" : "made no profit"} this round, so no Life NFTs were issued.</div>}
        </div>
        <button className="chip shrink-0" onClick={() => setDetails(!details)} aria-expanded={details}>
          {details ? "Hide" : "Details"}
        </button>
      </div>

      {details && (
        <>
          <dl className="num grid grid-cols-3 gap-2 border-t border-[var(--line)] pt-3 text-sm">
            <div>
              <dt className="label">Traders lost</dt>
              <dd className="font-extrabold">${fmtUsdc(BigInt(s.losses), 0)}</dd>
            </div>
            <div>
              <dt className="label">To Life NFTs</dt>
              <dd className="font-extrabold">${fmtUsdc(BigInt(s.lives_pot), 0)}</dd>
            </div>
            <div>
              <dt className="label">Buyback</dt>
              <dd className="font-extrabold">${fmtUsdc(BigInt(s.buyback_pot), 0)}</dd>
            </div>
          </dl>
          {board && board.top.length > 0 && (
            <div className="border-t border-[var(--line)] pt-3">
              <h3 className="text-sm font-extrabold">Top traders this round</h3>
              <ol className="mt-1 flex flex-col">
                {board.top.slice(0, 5).map((r, i) => (
                  <li key={r.account} className="num flex items-center gap-2 py-1 text-sm" style={r.account === me ? { fontWeight: 800 } : undefined}>
                    <span className="display w-4 shrink-0 text-[var(--muted)]">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate" title={r.account}>
                      {short(r.account)}
                      {r.account === me ? " (you)" : ""}
                    </span>
                    <span className="label shrink-0">
                      {r.trades} trade{r.trades === 1 ? "" : "s"}
                    </span>
                    <span className="w-20 shrink-0 text-right" style={{ color: BigInt(r.pnl) >= 0n ? "var(--long)" : "var(--short)" }}>
                      {signed(BigInt(r.pnl))}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                {board.best && (
                  <div className="rounded-lg bg-[var(--panel-2)] p-2.5">
                    <div className="label">Best trade</div>
                    <b>{short(board.best.account)}</b>{" "}
                    <span className="num">
                      {board.best.side} {board.best.market_id.split("-")[0]} {board.best.leverage}×,{" "}
                      {Math.round((Number(BigInt(board.best.pnl) - BigInt(board.best.cut ?? 0)) / Number(board.best.margin)) * 100)}%
                    </span>
                  </div>
                )}
                {board.biggestLoss && (
                  <div className="rounded-lg bg-[var(--panel-2)] p-2.5">
                    <div className="label">Biggest single-trade loss</div>
                    <b>{short(board.biggestLoss.account)}</b> <span className="num">{signed(BigInt(board.biggestLoss.pnl))}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
