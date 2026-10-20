"use client";

import { fmtUsdc, ppmToNumber, type LifeInfo } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { fmtClock, useNow } from "./Header";

export function Lives() {
  const { o, d, me, tx, run } = useOneUp();
  const lives = usePoll(() => o.lives(me), [me]) ?? [];
  const expiry = usePoll(() => o.view<{ life_expiry_epochs: number }>(d.contracts.house, "get_params"), [], 60_000)?.life_expiry_epochs;
  const pending = usePoll(() => o.pendingLife(me), [me]);
  const epoch = usePoll(() => o.epoch(), []);
  const now = useNow();
  const claimable = lives.reduce((s, l) => s + BigInt(l.claimable), 0n);
  const left = epoch ? Math.max(0, epoch.started_at + d.epochLengthS - now) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-semibold">Pending Extra Life · epoch {epoch?.id ?? "…"}</div>
          <p className="label mt-1 max-w-xl">
            Your losses this epoch. When the epoch ends, the house&apos;s profit is split across its losers in proportion
            to what they lost: that share is your Extra Life&apos;s face value. If the house didn&apos;t make money, no
            lives are minted.
          </p>
        </div>
        <div className="text-right">
          <div className="num text-2xl font-bold">${pending ? fmtUsdc(BigInt(pending)) : "…"}</div>
          <div className="label num">lost · mints in {fmtClock(left)}</div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="font-semibold">Your Extra Lives ({lives.length})</div>
        <button
          className="btn btn-accent"
          disabled={claimable === 0n}
          onClick={() =>
            run(`Claim $${fmtUsdc(claimable)}`, () => tx.claimLives(lives.filter((l) => BigInt(l.claimable) > 0n).map((l) => l.token_id)))
          }
        >
          Claim ${fmtUsdc(claimable)}
        </button>
      </div>

      {lives.length === 0 && <p className="label">No Extra Lives yet. Lose a trade and wait for the epoch to end.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lives.map((l) => (
          <LifeCard key={l.token_id} l={l} expiry={expiry} />
        ))}
      </div>
    </div>
  );
}

function LifeCard({ l, expiry }: { l: LifeInfo; expiry?: number }) {
  const owed = BigInt(l.owed);
  const paid = BigInt(l.paid);
  const pct = owed === 0n ? 0 : Number((paid * 10_000n) / owed) / 100;
  return (
    <div className="panel relative overflow-hidden p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="label">{l.epoch === 0 ? "Seed" : `Epoch ${l.epoch}`}</div>
          <div className="text-lg font-bold">{l.full_heal ? "Full Heal" : l.expired ? "Expired" : "Extra Life"}</div>
        </div>
        <Heart full={l.full_heal} />
      </div>
      <dl className="num mt-3 grid grid-cols-2 gap-y-1 text-sm">
        <dt className="label">Face value</dt>
        <dd className="text-right">${fmtUsdc(BigInt(l.face))}</dd>
        <dt className="label">Cap</dt>
        <dd className="text-right">{ppmToNumber(BigInt(l.cap_ppm)).toFixed(2)}×</dd>
        <dt className="label">Earns up to</dt>
        <dd className="text-right">${fmtUsdc(owed)}</dd>
        <dt className="label">Paid so far</dt>
        <dd className="text-right">${fmtUsdc(paid)}</dd>
        <dt className="label">Claimable</dt>
        <dd className="text-right font-semibold">${fmtUsdc(BigInt(l.claimable))}</dd>
      </dl>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--panel-2)]" role="progressbar" aria-valuenow={pct}>
        <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="label num mt-1">
        {pct.toFixed(1)}% to Full Heal
        {l.epoch > 0 && expiry !== undefined && !l.full_heal && (l.expired ? " · stopped earning" : ` · earns through epoch ${l.epoch + expiry}`)}
      </div>
    </div>
  );
}

function Heart({ full }: { full: boolean }) {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"
        fill={full ? "var(--accent)" : "none"}
        stroke="var(--accent)"
        strokeWidth="2"
      />
    </svg>
  );
}
