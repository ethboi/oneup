"use client";

// The jackpot (D-27): the interest the house's idle pool earns, drawn every few rounds among that period's
// losers, a ticket for each dollar of net loss.

import { USDC, fmtUsdc } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { PixelAmount, PixelCoin } from "./Pixel";
import { useNow } from "./Header";

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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PixelCoin size={22} />
          <h2 className="font-extrabold">Jackpot</h2>
        </div>
        <span className="label num">
          {left === null ? "…" : `draws in ${fmtDuration(left)}`}
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="bezel rounded-xl px-3 py-2">
          <div className="lcd rounded-lg px-3 py-2">
            <PixelAmount text={`$${fmtUsdc(pot, pot < 1_000n * USDC ? 2 : 0)}`} height={compact ? 30 : 40} />
          </div>
        </div>
        <div className="num text-right text-sm">
          <div>
            <b>{fmtUsdc(myTickets, 0)}</b> <span className="label">tickets</span>
          </div>
          <div className="label">{myTickets > 0n ? `${odds.toFixed(odds < 1 ? 2 : 1)}% chance` : "lose a trade to get some"}</div>
        </div>
      </div>
      <p className="label mt-3">
        The house&apos;s idle USDC earns interest; all of it goes here. Each $1 you lose is a ticket, and one ticket takes the lot.
      </p>
    </div>
  );
}
