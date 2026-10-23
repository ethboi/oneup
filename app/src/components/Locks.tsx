"use client";

// Locks: stake $1UP for up to two years and earn the house's buybacks by weight (amount × time left).
// Losers' $1UP arrives here already locked. A summary with Claim all and Merge, then your locks as rows;
// closed ones fold away. Leave early for a penalty, or sell a lock on the market.

import { parseTokenAmount } from "@oneup/sdk";
import { useEffect, useState } from "react";
import { ONEUP, USDC, VE_MAX_EPOCHS, type LockInfo } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lockOrigin, lockCountdown } from "@/lib/locks";
import { lockValue, useOneupPrice } from "@/lib/value";
import { fmtOneup, fmtUsd } from "./Header";
import { Icon } from "./Icon";
import { Sell, useListings } from "./Sell";
import { Empty, Explainer, OnExplorer, PanelHead, Stat, SummaryBar } from "./ui";

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
      return o.veClaimables(locks.map(l => l.token_id), past);
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
  const rewardLocks = running.filter((l) => l.from_loss && id < l.end);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
      {/* phones: the left column dissolves so the title, then the price and form, then the locks run in order */}
      <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-5">
        <div className="order-1">
          <Explainer title="Locks" line="Locked $1UP earns the house's buybacks, shared by weight: the amount × the rounds left ÷ 104.">
            Each round, 30% of the house&apos;s payout buys back $1UP for everyone locked. A lock&apos;s weight counts from the
            round after it&apos;s made and shrinks as it runs down. Leaving early costs up to half, less as the lock runs down,
            and the penalty goes to everyone still locked. Losers&apos; $1UP arrives already locked for {MAX} rounds. A lock is an
            NFT: sell it on the market instead of leaving early.
          </Explainer>
        </div>
        <div className="panel order-3 min-w-0 divide-y divide-[var(--line)]">
          <SummaryBar
            action={
              <button
                className="btn btn-accent w-full sm:w-auto"
                disabled={claimSum === 0n}
                onClick={() => run(`Claim ${fmtOneup(claimSum.toString(), 2)} $1UP`, () => tx.claimVeMany(toClaim.slice(0, 30).map(([k]) => k), past))}
              >
                <Icon name="claim" />
                {claimSum > 0n ? `Claim all ${fmtOneup(claimSum.toString(), 2)}` : "Nothing to claim yet"}
              </button>
            }
          >
            <Stat label="Locked" value={`${fmtOneup(locked.toString())} $1UP`} sub={px > 0n ? `≈ ${fmtUsd((locked * px) / ONEUP)}` : undefined} />
            <Stat label="Your weight next round" value={fmtOneup(mine.toString())} />
            <Stat label="Your share" value={`${share.toFixed(2)}%`} />
            <Stat label="Recent buybacks" value={`${fmtOneup((recent ?? 0n).toString())} $1UP`} />
          </SummaryBar>

          <div className="divide-y divide-[var(--line)]">
            <PanelHead
              title={`Running (${running.length})`}
              action={
                rewardLocks.length >= 2 && (
                  <button
                    className="chip inline-flex items-center gap-1.5"
                    onClick={() => run(`Merge ${rewardLocks.length} reward locks`, () => tx.mergeLocks(rewardLocks.slice(0, 30).map((l) => l.token_id)))}
                    title="One lock with the total amount, ending at the latest end. Claim first: it counts from next round."
                  >
                    <Icon name="merge" />
                    Merge {rewardLocks.length} reward locks
                  </button>
                )
              }
            />
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
      {/* phones: the price and the form before a long list of locks */}
      <div className="order-2 flex flex-col gap-4 lg:order-none">
        <OneupPrice px={px} locked={locked} />
        <LockForm px={px} />
      </div>
    </div>
  );
}

function LockRow({ l, epoch, px, claimable, listings }: { l: LockInfo; epoch: number; px: bigint; claimable: bigint; listings: ReturnType<typeof useListings> }) {
  const { d, tx, run } = useOneUp();
  const [leaving, setLeaving] = useState(false);
  const left = Math.max(0, l.end - epoch - 1);
  const ended = epoch >= l.end;
  const penalty = BigInt(l.exit_penalty);
  const worth = px > 0n && !l.withdrawn ? lockValue(l, px) : null;
  const origin = lockOrigin(l);
  return (
    <div className="p-3 sm:p-4">
      {/* fixed widths on the right, as on Extra Lives, so the bars line up */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_6.5rem_16rem] sm:gap-x-4">
        <div className="min-w-0">
          <div className="num flex items-center gap-1.5 font-extrabold">
            {fmtOneup(l.amount)} $1UP
            <OnExplorer nft={{ contract: d.contracts.ve, id: l.token_id }} />
          </div>
          <div className="label truncate">{origin}</div>
        </div>
        <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-1 sm:col-start-2">
          <div className="h-2 overflow-hidden rounded-full bg-[var(--panel-2)]" role="progressbar" aria-label="Lock time left" aria-valuenow={left} aria-valuemin={0} aria-valuemax={MAX}>
            <div className="h-full rounded-full bg-[var(--info)]" style={{ width: `${(l.withdrawn ? 0 : left / MAX) * 100}%` }} />
          </div>
          <div className="label num mt-1">
            {l.withdrawn
              ? l.exited !== null
                ? `Closed in round ${l.exited}`
                : "Unlocked"
              : (
                  <>
                    <span className="block">
                      {lockCountdown(l.end, epoch)}
                    </span>
                    <span className="block">Weight {fmtOneup(l.power)}</span>
                  </>
                )}
          </div>
        </div>
        <div className="text-right sm:col-start-3">
          <div className="num font-extrabold" style={claimable > 0n ? { color: "var(--long)" } : undefined}>
            {claimable > 0n ? fmtOneup(claimable.toString(), 2) : worth !== null ? fmtUsd(worth) : "–"}
          </div>
          <div className="label">{claimable > 0n ? "$1UP to claim" : worth !== null ? "if left today" : ""}</div>
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
                <div className="min-w-0 flex-1">
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

/** The $1UP price now, how it moved over the last day (sampled by the app's server), and what yours is worth. */
function OneupPrice({ px, locked }: { px: bigint; locked: bigint }) {
  const { o, me } = useOneUp();
  const wallet = BigInt(usePoll(() => o.oneupBalance(me), [me]) ?? "0");
  const [samples, setSamples] = useState<[number, number][]>([]);
  useEffect(() => {
    let live = true;
    const tick = () =>
      fetch("/api/oneup-price")
        .then((x) => (x.ok ? x.json() : { samples: [] }))
        .then((j) => live && setSamples(j.samples ?? []))
        .catch(() => {});
    tick();
    const i = setInterval(tick, 60_000);
    return () => {
      live = false;
      clearInterval(i);
    };
  }, []);
  const now = Number(px);
  const first = samples[0]?.[1];
  const change = first && now ? (now / first - 1) * 100 : null;
  const mins = samples.length ? Math.max(1, Math.round((Date.now() - samples[0][0]) / 60_000)) : 0;
  const span = mins < 90 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  const pts = [...samples.map((x) => x[1]), ...(now ? [now] : [])];
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const line = pts.length > 1 ? pts.map((v, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * 100).toFixed(2)} ${(hi > lo ? 28 - ((v - lo) / (hi - lo)) * 24 : 15).toFixed(2)}`).join(" ") : null;
  const tone = change === null || change === 0 ? "var(--muted)" : change > 0 ? "var(--long)" : "var(--short)";
  return (
    <div className="panel p-4">
      <div className="ticket-row">
        <h2 className="text-lg font-extrabold">$1UP price</h2>
        <span className="num text-sm font-bold" style={{ color: tone }}>
          {change === null ? "" : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(2)}% · ${span}`}
        </span>
      </div>
      <div className="num mt-1 text-3xl font-extrabold">{px > 0n ? `$${(now / 1e6).toFixed(now < 100_000 ? 4 : 2)}` : "…"}</div>
      {line && (
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-2 h-12 w-full" aria-label={`$1UP over the last ${span}`} role="img">
          <path d={line} fill="none" stroke={tone} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      )}
      <p className="label mt-1">From the swap pool; buybacks push it up. Sampled every minute.</p>
      <dl className="num mt-3 flex flex-col gap-1.5 border-t border-[var(--line)] pt-3 text-sm">
        <div className="ticket-row">
          <dt className="label">In your wallet</dt>
          <dd className="font-bold">
            {fmtOneup(wallet.toString())} <span className="label font-normal">{px > 0n ? `≈ ${fmtUsd((wallet * px) / ONEUP)}` : ""}</span>
          </dd>
        </div>
        <div className="ticket-row">
          <dt className="label">Locked</dt>
          <dd className="font-bold">
            {fmtOneup(locked.toString())} <span className="label font-normal">{px > 0n ? `≈ ${fmtUsd((locked * px) / ONEUP)}` : ""}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function LockForm({ px }: { px: bigint }) {
  const { o, me, tx, run } = useOneUp();
  const wallet = BigInt(usePoll(() => o.oneupBalance(me), [me]) ?? "0");
  const whole = wallet / ONEUP;
  const [amount, setAmount] = useState("");
  const [epochs, setEpochs] = useState(MAX);
  const raw = parseTokenAmount(amount, 18);
  const over = raw > wallet;
  const years = epochs / 52;
  return (
    <div className="panel flex flex-col gap-3 p-4">
      <h2 className="text-lg font-extrabold">Lock $1UP</h2>
      <div className="ticket-row text-sm">
        <span className="label">Available to lock</span>
        <span className="num font-bold">{fmtOneup(wallet.toString())} $1UP</span>
      </div>
      <span className="field">
        <input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="$1UP amount" inputMode="decimal" placeholder="0" />
        <span className="field-unit">$1UP</span>
      </span>
      {whole > 0n && (
        <span className="chip-track" role="group" aria-label="Amount presets">
          {([25, 50, 75, 100] as const).map((pc) => {
            const v = String((whole * BigInt(pc)) / 100n);
            return (
              <button key={pc} type="button" className="chip num flex-1 px-0" aria-pressed={amount === v} onClick={() => setAmount(v)}>
                {pc === 100 ? "Max" : `${pc}%`}
              </button>
            );
          })}
        </span>
      )}
      {raw > 0n && px > 0n && !over && <span className="label num -mt-1">≈ {fmtUsd((raw * px) / ONEUP)} at today&apos;s price</span>}
      {over && <span className="text-sm text-[var(--short)]">That&apos;s more than your wallet holds.</span>}
      {wallet === 0n && (
        <p className="label">
          Your wallet has no $1UP to lock. Losers&apos; $1UP arrives already locked, and locks can be bought on the Market.
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className="label flex justify-between">
          <span>Lock for</span>
          <span className="num font-bold text-[var(--text)]">
            {epochs} rounds{epochs >= 13 ? ` (about ${years >= 1 ? `${years.toFixed(1)} years` : `${Math.round(epochs / 4.33)} months`})` : ""}
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
        Weight {((Number(amount) || 0) * epochs / MAX).toLocaleString("en-US", { maximumFractionDigits: 0 })}, shrinking each round.
        Leaving early costs up to half, less as the lock runs down.
      </p>
      <button className="btn btn-accent" disabled={raw === 0n || over} onClick={() => run(`Lock ${amount} $1UP`, () => tx.lock(raw, epochs)).then((ok) => ok && setAmount(""))}>
        <Icon name="lock" />
        {raw > 0n ? `Lock ${Number(amount).toLocaleString("en-US")} $1UP` : "Lock"}
      </button>
    </div>
  );
}
