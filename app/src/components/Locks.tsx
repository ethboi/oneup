"use client";

// Locks: stake $1UP for up to 104 rounds and earn the house's buybacks by weight (amount × time left).
// Losers' $1UP arrives here already locked. A summary with Claim all and Merge, then your locks as cards;
// closed ones fold away. Leave early for a penalty, or sell a lock on the market.

import { parseTokenAmount } from "@oneup/sdk";
import { useEffect, useRef, useState } from "react";
import { ONEUP, VE_MAX_EPOCHS, type LockInfo } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { CLAIM_ROUNDS, isSettledRound, lockOrigin, lockCountdown, roundsToCheck } from "@/lib/locks";
import { lockValue, useOneupPrice } from "@/lib/value";
import { fmtOneup, fmtUsd } from "./Header";
import { Icon } from "./Icon";
import { LockCard } from "./LockCard";
import { Sell, useListings } from "./Sell";
import { ConnectPrompt, Empty, Explainer, OnExplorer, PanelHead, RoundPace, Stat, SummaryBar } from "./ui";

const MAX = Number(VE_MAX_EPOCHS);

export function Locks() {
  const { o, me, tx, run, viewOnly } = useOneUp();
  const locks = usePoll(() => o.locks(me), [me]) ?? [];
  const epoch = usePoll(() => o.epoch(), []);
  const pending = usePoll(() => o.pendingPower(), []);
  const listings = useListings();
  const px = useOneupPrice();
  const [showClosed, setShowClosed] = useState(false);
  const id = epoch?.id ?? 0;
  // every finished round with rewards since the oldest lock began, newest first: a returning trader's older rewards
  // still show. Only those rounds are worth asking about, and a settled round's answer is remembered.
  const oldest = locks.reduce((min, l) => Math.min(min, l.created), id);
  const settled = useRef(new Map<number, boolean>());
  const rewarded =
    usePoll(async () => {
      const known = new Set(settled.current.keys());
      const fresh = new Map<number, boolean>();
      for (const e of roundsToCheck(oldest, id, known)) {
        const has = BigInt(await o.lockRewards(e)) > 0n;
        fresh.set(e, has);
        if (isSettledRound(e, id)) settled.current.set(e, has);
      }
      return [...new Map([...settled.current, ...fresh])].filter(([, has]) => has).map(([e]) => e).sort((a, b) => b - a);
    }, [oldest, id], 15_000) ?? [];
  const past = rewarded;
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
          <Explainer title="Locks" line="Lock $1UP to share in buyback rewards. Your share depends on how much you lock and how long it remains locked.">
            Each round, 30% of the house&apos;s payout budget is used to buy back $1UP. These rewards are shared by weight: the locked amount × remaining rounds ÷ {MAX}. A new lock starts earning from the next round, and its weight decreases each round.
            Early withdrawal costs up to 50% of the locked amount; the penalty decreases over time and is shared among the remaining locks. $1UP awarded for eligible trading losses is locked for {MAX} rounds. Each lock is an NFT that you can list for sale.
          </Explainer>
          <RoundPace rounds={MAX} className="mt-1.5" />
        </div>
        {viewOnly ? (
        <div className="panel order-3 min-w-0">
          <ConnectPrompt icon="lock" also={<a className="btn btn-ghost" href="/market">See locks for sale</a>}>
            <b className="text-[var(--text)]">Connect a wallet to see your locks.</b>{" "}
            {recent ? `The last two rounds bought back ${fmtOneup(recent.toString())} $1UP for lock holders.` : "Locks share each round's $1UP buyback."}
          </ConnectPrompt>
        </div>
        ) : (
        <div className="panel order-3 min-w-0 divide-y divide-[var(--line)]">
          <SummaryBar
            action={
              <button
                className="btn btn-accent w-full sm:w-auto"
                disabled={claimSum === 0n}
                title="Claim available rewards from up to 30 locks."
                onClick={() => run("Claim rewards from up to 30 locks", () => tx.claimVeMany(toClaim.slice(0, 30).map(([k]) => k), past.slice(0, CLAIM_ROUNDS)))}
              >
                <Icon name="claim" />
                {claimSum > 0n ? "Claim rewards" : "No rewards to claim"}
              </button>
            }
          >
            <Stat label="Locked" value={`${fmtOneup(locked.toString())} $1UP`} sub={px > 0n ? `≈ ${fmtUsd((locked * px) / ONEUP)}` : undefined} />
            <Stat label="Your weight next round" value={fmtOneup(mine.toString())} />
            <Stat label="Your share next round" value={`${share.toFixed(2)}%`} />
            <Stat label="Recent buybacks" value={`${fmtOneup((recent ?? 0n).toString())} $1UP`} />
          </SummaryBar>

          <div className="divide-y divide-[var(--line)]">
            <PanelHead
              title={`Active locks (${running.length})`}
              action={
                rewardLocks.length >= 2 && (
                  <button
                    className="chip inline-flex items-center gap-1.5"
                    onClick={() => run("Merge up to 30 reward locks", () => tx.mergeLocks(rewardLocks.slice(0, 30).map((l) => l.token_id)))}
                    title="Combine up to 30 reward locks. The new lock holds their total amount and ends at the latest unlock round. Claim rewards first; the merged lock starts earning next round."
                  >
                    <Icon name="merge" />
                    Merge {Math.min(rewardLocks.length, 30)} reward locks
                  </button>
                )
              }
            />
            {running.length === 0 ? (
              <Empty icon="lock">No locks yet. Lock $1UP from your wallet or buy a lock on the market. Eligible net trading losses can also earn you $1UP in a {MAX}-round reward lock.</Empty>
            ) : (
              <div className="life-grid lock-grid">
                {running
                  .sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)))
                  .map((l) => <LockTile key={l.token_id} l={l} epoch={id} px={px} claimable={claimable[l.token_id] ?? 0n} listings={listings} />)}
              </div>
            )}
          </div>

          {closed.length > 0 && (
            <div className="divide-y divide-[var(--line)]">
              <PanelHead
                title={`Closed locks (${closed.length})`}
                action={
                  <button className="chip" onClick={() => setShowClosed(!showClosed)} aria-expanded={showClosed}>
                    {showClosed ? "Hide" : "Show"}
                  </button>
                }
              />
              {showClosed && (
                <div className="life-grid lock-grid">
                  {closed.map((l) => <LockTile key={l.token_id} l={l} epoch={id} px={px} claimable={claimable[l.token_id] ?? 0n} listings={listings} />)}
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </div>
      {/* phones: the price and the form before a long list of locks */}
      <div className="order-2 flex flex-col gap-4 lg:order-none">
        <OneupPrice px={px} locked={locked} />
        <LockForm px={px} />
      </div>
    </div>
  );
}

function LockTile({ l, epoch, px, claimable, listings }: { l: LockInfo; epoch: number; px: bigint; claimable: bigint; listings: ReturnType<typeof useListings> }) {
  const { d, tx, run } = useOneUp();
  const [leaving, setLeaving] = useState(false);
  const left = Math.max(0, l.end - epoch);
  const ended = epoch >= l.end;
  const penalty = BigInt(l.exit_penalty);
  const worth = px > 0n && !l.withdrawn ? lockValue(l, px) : null;
  const closedText = l.exited !== null ? `Closed in round ${l.exited}` : "Unlocked";
  return (
    <div className={`lock-tile ${leaving && !l.withdrawn ? "leaving" : ""}`} title={l.withdrawn ? closedText : lockCountdown(l.end, epoch)}>
      <LockCard
        id={l.token_id}
        left={left}
        of={MAX}
        state={l.withdrawn ? "closed" : ended ? "ready" : "locked"}
        tone={l.merged > 0 ? "merged" : l.from_loss ? "recovery" : "locked"}
        tag={l.merged > 0 ? "MERGED" : l.from_loss ? "REWARD" : "LOCKED"}
        detail={l.merged > 0 ? `${l.merged} locks` : `Round ${l.created}`}
        foot={l.withdrawn ? "CLOSED" : ended ? "READY" : `${left} ROUND${left === 1 ? "" : "S"}`}
        amount={`${fmtOneup(l.amount)} $1UP`}
        extra={
          claimable > 0n && (
            <span className="life-card-claim">
              <span>TO CLAIM</span>
              <span className="num">{fmtOneup(claimable.toString(), 2)}</span>
            </span>
          )
        }
      />
      <div className="flex min-w-0 flex-col gap-2">
        <div className="label num flex flex-col gap-0.5">
          {l.withdrawn ? (
            <span>{closedText}</span>
          ) : (
            <>
              <span>Weight {fmtOneup(l.power)}</span>
              {worth !== null && <span>{fmtUsd(worth)} after exit penalty</span>}
            </>
          )}
          <span className="flex items-center gap-1">
            {lockOrigin(l)}
            <OnExplorer nft={{ contract: d.contracts.ve, id: l.token_id }} />
          </span>
        </div>
        {!l.withdrawn && (
          <div className="flex gap-2">
            {ended ? (
              <button className="btn btn-accent flex-1" onClick={() => run(`Unlock #${l.token_id}`, () => tx.unlock(l.token_id))}>
                <Icon name="unlock" />
                Unlock
              </button>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <Sell nft={d.contracts.ve} tokenId={l.token_id} listings={listings} compact />
                </div>
                <button className="btn btn-ghost px-2.5" onClick={() => setLeaving(!leaving)} aria-expanded={leaving} aria-label="Withdraw early" title="Withdraw early">
                  <Icon name="leave" />
                </button>
              </>
            )}
          </div>
        )}
        {leaving && !l.withdrawn && (
          <div className="flex flex-col gap-2 rounded-lg border border-[var(--short)] p-3 text-sm">
            <p>
              Withdraw now to receive <b className="num">{fmtOneup((BigInt(l.amount) - penalty).toString())} $1UP</b>. A penalty of{" "}
              <b className="num">{fmtOneup(penalty.toString())} $1UP</b> ({((Number(penalty) / Number(l.amount)) * 100).toFixed(1)}%) is shared among the remaining locks. You can also list this lock for sale, but a sale requires a buyer.
            </p>
            <button
              className="btn"
              style={{ "--btn-bg": "var(--short-fill)", color: "var(--on-fill)" } as React.CSSProperties}
              onClick={() => run(`Withdraw from lock #${l.token_id} early`, () => tx.exitEarly(l.token_id)).then(() => setLeaving(false))}
            >
              Confirm early withdrawal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The $1UP price now, how it moved over the last day (sampled by the app's server), and what yours is worth. */
function OneupPrice({ px, locked }: { px: bigint; locked: bigint }) {
  const { o, me, d, viewOnly } = useOneUp();
  const wallet = BigInt(usePoll(() => o.oneupBalance(me), [me]) ?? "0");
  const [samples, setSamples] = useState<[number, number][]>([]);
  useEffect(() => {
    if (d.network !== "localnet") return;
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
  }, [d.network]);
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
      <p className="label mt-1">{d.network === "localnet" ? "Quote from the swap pool, sampled every minute. The price can change." : "Current quote from the test swap pool. Historical prices are unavailable on testnet."}</p>
      {!viewOnly && <dl className="num mt-3 flex flex-col gap-1.5 border-t border-[var(--line)] pt-3 text-sm">
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
      </dl>}
    </div>
  );
}

function LockForm({ px }: { px: bigint }) {
  const { o, me, tx, run, viewOnly, wallet: account } = useOneUp();
  const wallet = BigInt(usePoll(() => o.oneupBalance(me), [me]) ?? "0");
  const whole = wallet / ONEUP;
  const [amount, setAmount] = useState("");
  const [epochs, setEpochs] = useState(MAX);
  const raw = parseTokenAmount(amount, 18);
  // without a wallet there is no balance to exceed: the button asks for one
  const over = !viewOnly && raw > wallet;
  return (
    <div className="panel flex flex-col gap-3 p-4">
      <h2 className="text-lg font-extrabold">Lock $1UP</h2>
      {!viewOnly && (
        <div className="ticket-row text-sm">
          <span className="label">Available to lock</span>
          <span className="num font-bold">{fmtOneup(wallet.toString())} $1UP</span>
        </div>
      )}
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
      {raw > 0n && px > 0n && !over && <span className="label num -mt-1">≈ {fmtUsd((raw * px) / ONEUP)} at the current price</span>}
      {over && <span className="text-sm text-[var(--short)]">This amount exceeds your wallet balance.</span>}
      {wallet === 0n && !viewOnly && (
        <p className="label">
          Your wallet has no unlocked $1UP. Trading rewards arrive in locks, and you can buy locks on the market.
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className="label flex justify-between">
          <span>Lock for</span>
          <span className="num font-bold text-[var(--text)]">
            {epochs} {epochs === 1 ? "round" : "rounds"}
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
        Starting weight: {((Number(amount) || 0) * epochs / MAX).toLocaleString("en-US", { maximumFractionDigits: 0 })}. Weight decreases each round. Early withdrawal costs up to 50% of the locked amount; the penalty decreases over time.
      </p>
      {viewOnly ? (
        <button className="btn btn-accent" disabled={account.busy} onClick={() => void account.connect()}>
          <Icon name="wallet" />
          Connect wallet to lock
        </button>
      ) : (
        <button className="btn btn-accent" disabled={raw === 0n || over} onClick={() => run(`Lock ${amount} $1UP`, () => tx.lock(raw, epochs)).then((ok) => ok && setAmount(""))}>
          <Icon name="lock" />
          {raw > 0n ? `Lock ${Number(amount).toLocaleString("en-US")} $1UP` : "Lock"}
        </button>
      )}
    </div>
  );
}
