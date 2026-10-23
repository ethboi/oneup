"use client";

// Backing the house (D-22): anyone adds USDC to the pool during the bootstrap round and gets a Backer Life,
// an Extra Life that never expires, owed more the earlier the dollar went in (the same 2.0× → 1.2× curve
// losers get). The money stays in the pool for good and comes back only from house profit; to leave
// early, sell the Backer Life on the Market.

import { parseTokenAmount } from "@oneup/sdk";
import { useState } from "react";
import { fmtUsdc, lifeCapPpm, ppmToNumber, LIFE_CAP_POOL, USDC } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { fmtOneup } from "./Header";

export function Backing() {
  const { o, me, tx, run } = useOneUp();
  const [amount, setAmount] = useState("1000");
  const amt = parseTokenAmount(amount, 6);
  const round = usePoll(() => o.backing(amt > 0n ? amt : undefined), [amount], 4000);
  const pool = usePoll(() => o.pool(), [], 4000);
  const wallet = usePoll(() => o.usdcBalance(me), [me]);
  const mine = (usePoll(() => o.lives(me), [me], 5000) ?? []).filter((l) => l.backer);
  if (!round || !pool) return null;

  const backed = BigInt(round.backed);
  const target = BigInt(round.target);
  const min = BigInt(round.min);
  const left = target > backed ? target - backed : 0n;
  const tooBig = amt > left;
  const short = wallet !== undefined && amt > BigInt(wallet);
  const owedMine = mine.reduce((s, l) => s + BigInt(l.owed), 0n);
  const paidMine = mine.reduce((s, l) => s + BigInt(l.paid), 0n);

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-extrabold">Back with USDC</h2>
        <span className="label num">
          ${fmtUsdc(backed, 0)} of ${fmtUsdc(target, 0)} raised
        </span>
      </div>
      <p className="label mt-1 max-w-3xl">
        Your USDC joins the pool for good and gives traders room to trade. In return you get a Backer Life: an Extra Life that never
        expires, paid from a third of every round&apos;s Extra Life payout, and owed more the earlier you back. You also get $1UP,
        locked for 104 rounds, earning the house&apos;s buybacks. An early exit requires a willing buyer on the Market; sale proceeds are not guaranteed.
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Curve pool={BigInt(pool)} amount={round.open && !tooBig ? amt : 0n} />
        <div className="flex flex-col gap-3">
          {round.open ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="label">Amount</span>
                <span className="field">
                  <span className="field-unit">$</span>
                  <input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
                </span>
              </label>
              <dl className="num grid grid-cols-2 gap-y-1 text-sm">
                <dt className="label">Owed back</dt>
                <dd className="text-right font-bold">{ppmToNumber(BigInt(round.cap_ppm)).toFixed(3)}×</dd>
                <dt className="label">Maximum Backer Life payout</dt>
                <dd className="text-right font-bold">${fmtUsdc(BigInt(round.owed), 0)}</dd>
                <dt className="label">Plus $1UP, locked 104 rounds</dt>
                <dd className="text-right font-bold">{fmtOneup(round.oneup)}</dd>
                <dt className="label">Room left in the round</dt>
                <dd className="text-right">${fmtUsdc(left, 0)}</dd>
              </dl>
              <button
                className="btn btn-accent"
                disabled={amt < min || tooBig || short}
                onClick={() => run(`Back the house with $${fmtUsdc(amt, 0)}`, () => tx.back(amt))}
              >
                {amt < min ? `Back at least $${fmtUsdc(min, 0)}` : tooBig ? "More than the round has left" : short ? "Not enough USDC in your wallet" : `Back $${fmtUsdc(amt, 0)}`}
              </button>
            </>
          ) : (
            <p className="text-sm font-bold">The bootstrap round is full. Backer Lives still trade on the Market.</p>
          )}
          {mine.length > 0 && (
            <p className="label num">
              Your {mine.length === 1 ? "Backer Life has" : `${mine.length} Backer Lives have`} been paid ${fmtUsdc(paidMine)} of $
              {fmtUsdc(owedMine, 0)}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The cap curve over pool size, with the round so far shaded and this backing's slice highlighted. */
function Curve({ pool, amount }: { pool: bigint; amount: bigint }) {
  const W = 600;
  const H = 150;
  const max = LIFE_CAP_POOL + LIFE_CAP_POOL / 5n;
  const x = (p: bigint) => Number((p * BigInt(W)) / max);
  const y = (ppm: bigint) => H - 18 - ((ppmToNumber(ppm) - 1) / 1.1) * (H - 30);
  const clamp = (p: bigint) => (p > max ? max : p);
  const pts = [0n, LIFE_CAP_POOL, max].map((p) => `${x(p)},${y(lifeCapPpm(p))}`).join(" ");
  const area = (a: bigint, b: bigint) =>
    `M${x(a)},${H - 18} L${x(a)},${y(lifeCapPpm(a))} L${x(clamp(b))},${y(lifeCapPpm(clamp(b)))} L${x(clamp(b))},${H - 18} Z`;
  const here = clamp(pool);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Owed ${ppmToNumber(lifeCapPpm(pool)).toFixed(2)}× at today's pool`}>
      <path d={area(0n, here)} fill="var(--panel-2)" />
      {amount > 0n && <path d={area(here, pool + amount)} fill="var(--accent)" opacity="0.35" />}
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" />
      <line x1="0" x2={W} y1={H - 18} y2={H - 18} stroke="var(--line)" />
      <line x1={x(here)} x2={x(here)} y1="8" y2={H - 18} stroke="var(--text)" strokeDasharray="3 3" />
      <text x={Math.min(x(here) + 6, W - 120)} y="18" className="label" fill="var(--text)" fontSize="12">
        Pool now ${Number(pool / USDC / 1000n).toLocaleString("en-US")}K · {ppmToNumber(lifeCapPpm(pool)).toFixed(2)}×
      </text>
      <text x="4" y={y(2_000_000n) - 6} fontSize="11" fill="var(--muted)">2.0×</text>
      <text x={W - 34} y={y(1_200_000n) - 6} fontSize="11" fill="var(--muted)">1.2×</text>
      <text x="4" y={H - 4} fontSize="11" fill="var(--muted)">$0</text>
      <text x={x(LIFE_CAP_POOL) - 20} y={H - 4} fontSize="11" fill="var(--muted)">$1M</text>
    </svg>
  );
}
