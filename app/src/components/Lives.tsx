"use client";

// Extra Lives: a summary and one Claim, the life the current epoch is building, then your lives as rows
// sorted by what they can still pay. Finished ones (fully healed or expired) fold away.

import { useState } from "react";
import { emissionsForEpoch, fmtUsdc, ppmToNumber, releasedEmissions, type LifeInfo, type Listing } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lifeValue } from "@/lib/value";
import { fmtClock, fmtOneup, useNow } from "./Header";
import { Icon } from "./Icon";
import { HealthBar, PixelHeart } from "./Pixel";
import { Sell, useListings } from "./Sell";
import { Empty, Explainer, Section, Stat, SummaryBar } from "./ui";

export function Lives() {
  const { o, d, me, tx, run } = useOneUp();
  const lives = usePoll(() => o.lives(me), [me]) ?? [];
  const expiry = usePoll(() => o.params(), [], 60_000)?.life_expiry_epochs;
  const epoch = usePoll(() => o.epoch(), []);
  const last = usePoll(() => (epoch && epoch.id > 1 ? o.epochSummary(epoch.id - 1) : Promise.resolve(null)), [epoch?.id]);
  const listings = useListings();
  const [showDone, setShowDone] = useState(false);

  const earning = lives.filter((l) => !l.expired && !l.full_heal).sort((a, b) => Number(lifeValue(b) - lifeValue(a)));
  const done = lives.filter((l) => l.expired || l.full_heal);
  const owedLeft = earning.reduce((s, l) => s + BigInt(l.owed) - BigInt(l.paid), 0n);
  const paid = lives.reduce((s, l) => s + BigInt(l.paid), 0n);
  const claimable = lives.reduce((s, l) => s + BigInt(l.claimable), 0n);

  return (
    <div className="flex flex-col gap-5">
      <Explainer line="Every loss in an epoch the house ends in profit becomes an Extra Life that pays you back in USDC.">
        When an epoch ends, the house&apos;s profit is shared across that epoch&apos;s losers by how much they lost: that
        share is the life&apos;s face value. It can earn up to face × its cap (2.0× when the pool is small, down to 1.2× at
        $1M). Each epoch, 60% of half the surplus above the reserve is shared across all earning lives by what they&apos;re
        still owed. A life earns for {expiry ?? 13} epochs after the one it&apos;s minted in, then keeps what it earned.
        Sell one on the market and its unclaimed USDC goes with it.
      </Explainer>

      <SummaryBar
        action={
          <button
            className="btn btn-accent w-full sm:w-auto"
            disabled={claimable === 0n}
            onClick={() => run(`Claim $${fmtUsdc(claimable)}`, () => tx.claimLives(lives.filter((l) => BigInt(l.claimable) > 0n).map((l) => l.token_id)))}
          >
            <Icon name="claim" />
            {claimable > 0n ? `Claim $${fmtUsdc(claimable)}` : "Nothing to claim yet"}
          </button>
        }
      >
        <Stat label="Still to earn" value={`$${fmtUsdc(owedLeft, 0)}`} />
        <Stat label="Paid so far" value={`$${fmtUsdc(paid)}`} />
        <Stat label="Ready to claim" value={`$${fmtUsdc(claimable)}`} tone={claimable > 0n ? "good" : undefined} />
        <Stat label="Last epoch, to all lives" value={last ? `$${fmtUsdc(BigInt(last.lives_pot), 0)}` : "–"} />
      </SummaryBar>

      <NextLife epochId={epoch?.id} left={epoch ? epoch.started_at + d.epochLengthS : 0} />

      <Section title={`Earning (${earning.length})`}>
        {earning.length === 0 ? (
          <Empty icon="heart">No Extra Lives earning. Lose a trade in an epoch the house ends in profit and one arrives when it closes.</Empty>
        ) : (
          <div className="panel divide-y divide-[var(--line)]">
            {earning.map((l) => (
              <LifeRow key={l.token_id} l={l} expiry={expiry} listings={listings} />
            ))}
          </div>
        )}
      </Section>

      {done.length > 0 && (
        <Section
          title={`Finished (${done.length})`}
          action={
            <button className="chip" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
              {showDone ? "Hide" : "Show"}
            </button>
          }
        >
          {showDone && (
            <div className="panel divide-y divide-[var(--line)]">
              {done.map((l) => (
                <LifeRow key={l.token_id} l={l} expiry={expiry} listings={listings} />
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

/** This epoch's losses so far, and the life and $1UP they'd bring if it closed now. */
function NextLife({ epochId, left }: { epochId?: number; left: number }) {
  const { o, me } = useOneUp();
  const pending = usePoll(() => o.pendingLife(me), [me]);
  const carry = usePoll(() => o.emissionCarry(), []);
  const epoch = usePoll(() => o.epoch(), []);
  const now = useNow();
  const lost = pending ? BigInt(pending) : 0n;
  let oneup = 0n;
  if (epoch && carry !== undefined && lost > 0n) {
    const losses = BigInt(epoch.losses);
    const net = losses > BigInt(epoch.payouts) ? losses - BigInt(epoch.payouts) : 0n;
    oneup = losses > 0n ? (releasedEmissions(BigInt(carry) + emissionsForEpoch(BigInt(epoch.id)), net) * lost) / losses : 0n;
  }
  return (
    <div className="panel flex items-center gap-3 px-4 py-3">
      <PixelHeart size={28} fill={lost > 0n ? 0.5 : 0} />
      <div className="min-w-0 flex-1 text-sm">
        <b>Next Extra Life, epoch {epochId ?? "…"}</b>
        <div className="label num">
          {lost > 0n
            ? `$${fmtUsdc(lost)} lost so far${oneup > 0n ? `, plus about ${fmtOneup(oneup.toString())} $1UP` : ""}. Mints in ${fmtClock(Math.max(0, left - now))}.`
            : `Nothing lost this epoch. It closes in ${fmtClock(Math.max(0, left - now))}.`}
        </div>
      </div>
    </div>
  );
}

function LifeRow({ l, expiry, listings }: { l: LifeInfo; expiry?: number; listings: Listing[] }) {
  const { d } = useOneUp();
  const owed = BigInt(l.owed);
  const paid = BigInt(l.paid);
  const progress = owed === 0n ? 0 : Number((paid * 10_000n) / owed) / 10_000;
  const earning = !l.expired && !l.full_heal;
  const state = l.full_heal ? "Full Heal" : l.expired ? "Expired" : `Earning through epoch ${l.epoch + (expiry ?? 13)}`;
  const value = lifeValue(l);
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 p-3 sm:grid-cols-[auto_1.2fr_1fr_auto_auto] sm:p-4" style={earning ? undefined : { opacity: 0.75 }}>
      {/* while earning the heart stays pink, filling as it pays out; finished ones go grey */}
      <PixelHeart size={34} fill={l.full_heal ? 1 : earning ? progress : 0} live={earning} label={`${state}, ${(progress * 100).toFixed(0)}% paid`} />
      <div className="min-w-0">
        <div className="font-extrabold">{l.epoch === 0 ? "Seed life" : `From epoch ${l.epoch}`}</div>
        <div className="label truncate">{state}</div>
      </div>
      <div className="col-span-3 row-start-2 sm:col-span-1 sm:row-start-1 sm:col-start-3">
        <HealthBar value={progress} label="Paid toward Full Heal" />
        <div className="label num mt-1">
          ${fmtUsdc(paid)} of ${fmtUsdc(owed)} · face ${fmtUsdc(BigInt(l.face), 0)} × {ppmToNumber(BigInt(l.cap_ppm)).toFixed(2)}
        </div>
      </div>
      <div className="text-right">
        <div className="num font-extrabold">{BigInt(l.claimable) > 0n ? `$${fmtUsdc(BigInt(l.claimable))}` : earning ? "Earning" : "–"}</div>
        <div className="label">{BigInt(l.claimable) > 0n ? "to claim" : earning ? `$${fmtUsdc(value, 0)} to go` : ""}</div>
      </div>
      <div className="col-span-3 sm:col-span-1 sm:w-56">
        {value > 0n && <Sell nft={d.contracts.life} tokenId={l.token_id} suggested={(value * 7n) / 10n} listings={listings} compact />}
      </div>
    </div>
  );
}
