"use client";

// Locks: stake $1UP for up to two years and earn the house's buybacks by weight (amount × time left).
// Losers' $1UP arrives here already locked. A summary with Claim all and Merge, then your locks as rows;
// closed ones fold away. Leave early for a penalty, or sell a lock on the market.

import { useState } from "react";
import { ONEUP, USDC, VE_MAX_EPOCHS, fmtUsdc, type LockInfo } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lockValue, useOneupPrice } from "@/lib/value";
import { fmtOneup } from "./Header";
import { Icon } from "./Icon";
import { Sell, useListings } from "./Sell";
import { Empty, Explainer, PanelHead, Stat, SummaryBar } from "./ui";

const MAX = Number(VE_MAX_EPOCHS);

export function Locks() {
  const { o, me, tx, run } = useOneUp();
  const locks = usePoll(() => o.locks(me), [me]) ?? [];
  const epoch = usePoll(() => o.epoch(), []);
  const pending = usePoll(() => o.pendingPower(), []);
  const listings = useListings();
  const px = useOneupPrice();
  const [showClosed, setShowClosed] = useState(false);
  const id = epoch?.id ?? 0;
  const past = Array.from({ length: Math.min(20, Math.max(0, id - 1)) }, (_, i) => id - 1 - i);
  // every lock's claimable in one poll
  const claimable =
    usePoll(async () => {
      const out: Record<string, bigint> = {};
      await Promise.all(locks.map(async (l) => (out[l.token_id] = BigInt(await o.veClaimable(l.token_id, past)))));
      return out;
    }, [locks.map((l) => l.token_id).join(), id]) ?? {};
  // buybacks land after their epoch ends; an epoch nobody is locked for passes its buyback to the next
  const recent = usePoll(
    async () => (id ? (await Promise.all([id - 1, id].filter((e) => e > 0).map((e) => o.lockRewards(e)))).reduce((a, x) => a + BigInt(x), 0n) : 0n),
    [id],
  );

  const running = locks.filter((l) => !l.withdrawn);
  const closed = locks.filter((l) => l.withdrawn);
  const locked = running.reduce((s, l) => s + BigInt(l.amount), 0n);
  const mine = running.reduce((s, l) => s + BigInt(l.power), 0n);
  const total = pending ? BigInt(pending) : 0n;
  const share = total > 0n ? Number((mine * 10_000n) / total) / 100 : 0;
  const toClaim = Object.entries(claimable).filter(([, v]) => v > 0n);
  const claimSum = toClaim.reduce((s, [, v]) => s + v, 0n);
  const lossLocks = running.filter((l) => l.from_loss && id < l.end);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-5">
        <Explainer line="Locked $1UP earns the house's buybacks, shared by weight: the amount × the epochs left ÷ 104.">
          Each epoch, 30% of the house&apos;s payout buys back $1UP for everyone locked. A lock&apos;s weight counts from the
          epoch after it&apos;s made and shrinks as it runs down. Leaving early costs up to half, less as the lock runs down,
          and the penalty goes to everyone still locked. Losers&apos; $1UP arrives already locked for {MAX} epochs. A lock is an
          NFT: sell it on the market instead of leaving early.
        </Explainer>

        <div className="panel divide-y divide-[var(--line)]">
          <SummaryBar
            action={
              <div className="flex flex-col gap-2 sm:items-end">
                <button
                  className="btn btn-accent w-full sm:w-auto"
                  disabled={claimSum === 0n}
                  onClick={() => run(`Claim ${fmtOneup(claimSum.toString(), 2)} $1UP`, () => tx.claimVeMany(toClaim.slice(0, 30).map(([k]) => k), past))}
                >
                  <Icon name="claim" />
                  {claimSum > 0n ? `Claim all ${fmtOneup(claimSum.toString(), 2)}` : "Nothing to claim yet"}
                </button>
                {lossLocks.length >= 2 && (
                  <button
                    className="btn btn-ghost w-full sm:w-auto"
                    onClick={() => run(`Merge ${lossLocks.length} loss-locks`, () => tx.mergeLocks(lossLocks.slice(0, 30).map((l) => l.token_id)))}
                    title="One lock with the total amount, ending at the latest end. Claim first: it counts from next epoch."
                  >
                    <Icon name="merge" />
                    Merge {lossLocks.length} loss-locks
                  </button>
                )}
              </div>
            }
          >
            <Stat label="Locked" value={`${fmtOneup(locked.toString())} $1UP`} />
            <Stat label="Your weight next epoch" value={fmtOneup(mine.toString())} />
            <Stat label="Your share" value={`${share.toFixed(2)}%`} />
            <Stat label="Recent buybacks" value={`${fmtOneup((recent ?? 0n).toString())} $1UP`} />
          </SummaryBar>

          <div className="divide-y divide-[var(--line)]">
            <PanelHead title={`Running (${running.length})`} />
            {running.length === 0 ? (
              <Empty icon="lock">No locks yet. Lock $1UP here, or lose a trade: losers get their $1UP as a two-year lock.</Empty>
            ) : (
              running
                .sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)))
                .map((l) => <LockRow key={l.token_id} l={l} epoch={id} px={px} claimable={claimable[l.token_id] ?? 0n} listings={listings} />)
            )}
          </div>

          {closed.length > 0 && (
            <div className="divide-y divide-[var(--line)]">
              <PanelHead
                title={`Closed (${closed.length})`}
                action={
                  <button className="chip" onClick={() => setShowClosed(!showClosed)} aria-expanded={showClosed}>
                    {showClosed ? "Hide" : "Show"}
                  </button>
                }
              />
              {showClosed &&
                closed.map((l) => <LockRow key={l.token_id} l={l} epoch={id} px={px} claimable={claimable[l.token_id] ?? 0n} listings={listings} />)}
            </div>
          )}
        </div>
      </div>
      <LockForm />
    </div>
  );
}

function LockRow({ l, epoch, px, claimable, listings }: { l: LockInfo; epoch: number; px: bigint; claimable: bigint; listings: ReturnType<typeof useListings> }) {
  const { d, tx, run } = useOneUp();
  const [leaving, setLeaving] = useState(false);
  const left = Math.max(0, l.end - epoch - 1);
  const ended = epoch >= l.end;
  const penalty = BigInt(l.exit_penalty);
  const origin = l.merged > 0 ? `Merged from ${l.merged} locks` : l.from_loss ? `From a loss in epoch ${l.created - 1}` : `Locked in epoch ${l.created}`;
  return (
    <div className="p-3 sm:p-4">
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[1.1fr_1.2fr_auto_auto]">
        <div className="min-w-0">
          <div className="num font-extrabold">{fmtOneup(l.amount)} $1UP</div>
          <div className="label truncate">{origin}</div>
        </div>
        <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-1 sm:col-start-2">
          <div className="h-2 overflow-hidden rounded-full bg-[var(--panel-2)]" role="progressbar" aria-label="Lock time left" aria-valuenow={left} aria-valuemin={0} aria-valuemax={MAX}>
            <div className="h-full rounded-full bg-[var(--info)]" style={{ width: `${(l.withdrawn ? 0 : left / MAX) * 100}%` }} />
          </div>
          <div className="label num mt-1">
            {l.withdrawn
              ? l.exited !== null
                ? `Closed in epoch ${l.exited}`
                : "Unlocked"
              : `Unlocks at epoch ${l.end} (${left} to go) · weight ${fmtOneup(l.power)}${px > 0n ? ` · worth $${fmtUsdc(lockValue(l, px), 0)} if left today` : ""}`}
          </div>
        </div>
        <div className="text-right sm:col-start-3">
          <div className="num font-extrabold">{claimable > 0n ? fmtOneup(claimable.toString(), 2) : l.withdrawn ? "–" : "Earning"}</div>
          <div className="label">{claimable > 0n ? "$1UP to claim" : ""}</div>
        </div>
        {!l.withdrawn && (
          <div className="col-span-2 flex gap-2 sm:col-span-1 sm:col-start-4">
            {ended ? (
              <button className="btn btn-accent flex-1" onClick={() => run(`Unlock #${l.token_id}`, () => tx.unlock(l.token_id))}>
                <Icon name="unlock" />
                Unlock
              </button>
            ) : (
              <>
                <div className="flex-1 sm:w-40">
                  <Sell nft={d.contracts.ve} tokenId={l.token_id} suggested={px > 0n ? (lockValue(l, px) * 8n) / 10n : USDC} listings={listings} compact />
                </div>
                <button className="btn btn-ghost px-2.5" onClick={() => setLeaving(!leaving)} aria-expanded={leaving} aria-label="Leave early" title="Leave early">
                  <Icon name="leave" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {leaving && !l.withdrawn && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-[var(--short)] p-3 text-sm sm:flex-row sm:items-center">
          <p className="flex-1">
            Leave now: you get <b className="num">{fmtOneup((BigInt(l.amount) - penalty).toString())} $1UP</b>; the other{" "}
            <b className="num">{fmtOneup(penalty.toString())}</b> ({((Number(penalty) / Number(l.amount)) * 100).toFixed(1)}%) goes to
            everyone still locked. Selling may get you more.
          </p>
          <button
            className="btn shrink-0"
            style={{ "--btn-bg": "var(--short-fill)", color: "var(--on-fill)" } as React.CSSProperties}
            onClick={() => run(`Leave lock #${l.token_id} early`, () => tx.exitEarly(l.token_id)).then(() => setLeaving(false))}
          >
            Leave and pay {fmtOneup(penalty.toString())}
          </button>
        </div>
      )}
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
