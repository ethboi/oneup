"use client";

// Locks: stake $1UP for up to two years and earn the house's buybacks by weight (amount × time left).
// Losers' $1UP arrives here already locked. Leave early for a penalty, or sell the lock on the market.

import { useState } from "react";
import { ONEUP, USDC, VE_MAX_EPOCHS, fmtUsdc, type LockInfo } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lockValue, useOneupPrice } from "@/lib/value";
import { fmtOneup } from "./Header";
import { Sell, useListings } from "./Sell";
import { Icon } from "./Icon";

const MAX = Number(VE_MAX_EPOCHS);

export function Locks() {
  const { o, me } = useOneUp();
  const locks = usePoll(() => o.locks(me), [me]) ?? [];
  const epoch = usePoll(() => o.epoch(), []);
  const pending = usePoll(() => o.pendingPower(), []);
  // buybacks land after their epoch ends; an epoch nobody was locked for passes its buyback to the next
  const recent = usePoll(
    async () => (epoch ? (await Promise.all([epoch.id - 1, epoch.id].filter((e) => e > 0).map((e) => o.lockRewards(e)))).reduce((a, x) => a + BigInt(x), 0n) : 0n),
    [epoch?.id],
  );
  const listings = useListings();
  const px = useOneupPrice();
  const mine = locks.filter((l) => !l.withdrawn).reduce((s, l) => s + BigInt(l.power), 0n);
  const total = pending ? BigInt(pending) : 0n;
  const share = total > 0n ? Number((mine * 10_000n) / total) / 100 : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="panel p-4">
          <div className="text-lg font-extrabold">Earn the house&apos;s buybacks</div>
          <p className="label mt-1 max-w-2xl">
            Each epoch, 30% of the house&apos;s payout buys back $1UP for everyone locked, shared by weight: the amount
            locked × the epochs left ÷ {MAX}. Your weight counts from the epoch after you lock, and shrinks as the lock runs
            down.
          </p>
          <dl className="num mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Your weight next epoch" value={fmtOneup(mine.toString())} />
            <Stat label="Your share" value={`${share.toFixed(2)}%`} />
            <Stat label="Buybacks, last and this epoch" value={`${fmtOneup((recent ?? 0n).toString())} $1UP`} />
          </dl>
        </div>

        <div className="text-lg font-extrabold">Your locks</div>
        {locks.length === 0 && <p className="label">No locks yet. Lock $1UP, or lose a trade: losers get their $1UP as a two-year lock.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {locks.map((l) => (
            <LockCard key={l.token_id} l={l} epoch={epoch?.id ?? 0} px={px} listings={listings} />
          ))}
        </div>
      </div>
      <LockForm />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="display num text-lg">{value}</dd>
    </div>
  );
}

function LockCard({ l, epoch, px, listings }: { l: LockInfo; epoch: number; px: bigint; listings: ReturnType<typeof useListings> }) {
  const { o, d, tx, run } = useOneUp();
  const past = Array.from({ length: Math.min(20, Math.max(0, epoch - 1)) }, (_, i) => epoch - 1 - i);
  const claimable = usePoll(() => o.veClaimable(l.token_id, past), [l.token_id, epoch]) ?? "0";
  const [leaving, setLeaving] = useState(false);
  const left = Math.max(0, l.end - epoch - 1);
  const ended = epoch >= l.end;
  const penalty = BigInt(l.exit_penalty);

  return (
    <div className="panel p-4" style={l.withdrawn ? { opacity: 0.7 } : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-extrabold leading-tight">
            <span className="num">{fmtOneup(l.amount)}</span> <span className="text-base">$1UP</span>
          </div>
          <div className="label">{l.from_loss ? `From a loss in epoch ${l.created - 1}` : `Locked by you in epoch ${l.created}`}</div>
        </div>
        <div className="text-right">
          <div className="display num text-xl">{fmtOneup(claimable, 2)}</div>
          <div className="label">$1UP to claim</div>
        </div>
      </div>
      <TimeBar left={l.withdrawn ? 0 : left} />
      <dl className="num mt-3 grid grid-cols-2 gap-y-1 text-sm">
        <dt className="label">Weight next epoch</dt>
        <dd className="text-right">{fmtOneup(l.power)}</dd>
        <dt className="label">{l.withdrawn ? (l.exited !== null ? "Left early in" : "Unlocked") : "Unlocks at"}</dt>
        <dd className="text-right">
          {l.withdrawn ? (l.exited !== null ? `epoch ${l.exited}` : "yes") : `epoch ${l.end} (${left} to go)`}
        </dd>
        {!l.withdrawn && px > 0n && (
          <>
            <dt className="label">Worth if left today</dt>
            <dd className="text-right">${fmtUsdc(lockValue(l, px), 0)}</dd>
          </>
        )}
      </dl>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className="btn btn-accent"
          disabled={BigInt(claimable) === 0n}
          onClick={() => run(`Claim lock #${l.token_id} rewards`, () => tx.claimVe(l.token_id, past))}
        >
          <Icon name="claim" />
          Claim
        </button>
        {ended && !l.withdrawn ? (
          <button className="btn btn-ghost" onClick={() => run(`Unlock #${l.token_id}`, () => tx.unlock(l.token_id))}>
            <Icon name="unlock" />
            Unlock
          </button>
        ) : (
          <button className="btn btn-ghost" disabled={l.withdrawn} onClick={() => setLeaving(!leaving)} aria-expanded={leaving}>
            <Icon name="leave" />
            Leave early
          </button>
        )}
      </div>
      {leaving && !l.withdrawn && (
        <div className="mt-3 rounded-lg border border-[var(--short)] p-3 text-sm">
          <p>
            You get <b className="num">{fmtOneup((BigInt(l.amount) - penalty).toString())} $1UP</b> now. The other{" "}
            <b className="num">{fmtOneup(penalty.toString())}</b> ({((Number(penalty) / Number(l.amount)) * 100).toFixed(1)}%)
            goes to everyone still locked. Selling the lock instead may get you more.
          </p>
          <button
            className="btn mt-2 w-full"
            style={{ "--btn-bg": "var(--short-fill)", color: "var(--on-fill)" } as React.CSSProperties}
            onClick={() => run(`Leave lock #${l.token_id} early`, () => tx.exitEarly(l.token_id)).then(() => setLeaving(false))}
          >
            Leave and pay {fmtOneup(penalty.toString())} $1UP
          </button>
        </div>
      )}
      {!l.withdrawn && <Sell nft={d.contracts.ve} tokenId={l.token_id} suggested={px > 0n ? (lockValue(l, px) * 8n) / 10n : USDC} listings={listings} />}
    </div>
  );
}

/** Time left on a lock, as a bar of the full 104 epochs. */
function TimeBar({ left }: { left: number }) {
  const pct = (left / MAX) * 100;
  return (
    <div className="mt-3 h-3 overflow-hidden rounded-md border border-[var(--edge)] bg-[var(--panel-2)]" role="progressbar" aria-label="Lock time left" aria-valuenow={left} aria-valuemin={0} aria-valuemax={MAX}>
      <div className="h-full bg-[var(--info)]" style={{ width: `${pct}%` }} />
    </div>
  );
}

function LockForm() {
  const { tx, run } = useOneUp();
  const [amount, setAmount] = useState("1000");
  const [epochs, setEpochs] = useState(MAX);
  const raw = BigInt(Math.floor(Number(amount) || 0)) * ONEUP;
  const years = epochs / 52;
  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="text-lg font-extrabold">Lock $1UP</div>
      <span className="field">
        <input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="$1UP amount" inputMode="decimal" />
        <span className="field-unit">$1UP</span>
      </span>
      <label className="flex flex-col gap-1">
        <span className="label flex justify-between">
          <span>Lock for</span>
          <span className="num font-bold text-[var(--text)]">
            {epochs} epochs{epochs >= 13 ? ` (about ${years >= 1 ? `${years.toFixed(1)} years` : `${Math.round(epochs / 4.33)} months`})` : ""}
          </span>
        </span>
        <input
          type="range"
          className="slider"
          min={1}
          max={MAX}
          value={epochs}
          onChange={(e) => setEpochs(Number(e.target.value))}
          style={{ "--fill": `${((epochs - 1) / (MAX - 1)) * 100}%` } as React.CSSProperties}
        />
      </label>
      <p className="label num">
        Weight {((Number(amount) || 0) * epochs / MAX).toLocaleString("en-US", { maximumFractionDigits: 0 })}, shrinking each epoch.
        Leaving early costs up to half, less as the lock runs down.
      </p>
      <button className="btn btn-accent" disabled={raw === 0n} onClick={() => run(`Lock ${amount} $1UP`, () => tx.lock(raw, epochs))}>
        <Icon name="lock" />
        Lock
      </button>
    </div>
  );
}
