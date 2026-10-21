"use client";

import { emissionsForEpoch, fmtUsdc, ppmToNumber, releasedEmissions, type LifeInfo, type Listing } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { fmtClock, useNow } from "./Header";
import { HealthBar, PixelHeart } from "./Pixel";
import { fmtOneup } from "./Header";
import { Sell, useListings } from "./Sell";
import { lifeValue } from "@/lib/value";
import { Icon } from "./Icon";

export function Lives() {
  const { o, d, me, tx, run } = useOneUp();
  const lives = usePoll(() => o.lives(me), [me]) ?? [];
  const expiry = usePoll(() => o.view<{ life_expiry_epochs: number }>(d.contracts.house, "get_params"), [], 60_000)?.life_expiry_epochs;
  const pending = usePoll(() => o.pendingLife(me), [me]);
  const epoch = usePoll(() => o.epoch(), []);
  const carry = usePoll(() => o.emissionCarry(), []);
  const listings = useListings();
  const now = useNow();
  const claimable = lives.reduce((s, l) => s + BigInt(l.claimable), 0n);
  const left = epoch ? Math.max(0, epoch.started_at + d.epochLengthS - now) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-lg font-extrabold">Next Extra Life, epoch <span className="num">{epoch?.id ?? "…"}</span></div>
          <p className="label mt-1 max-w-xl">
            Your losses this epoch. When the epoch ends, the house&apos;s profit is split across its losers in proportion
            to what they lost: that share is your Extra Life&apos;s face value. If the house didn&apos;t make money, no
            lives are minted.
          </p>
        </div>
        <div className="text-right">
          <div className="display num text-2xl">${pending ? fmtUsdc(BigInt(pending)) : "…"}</div>
          <div className="label num">lost so far, mints in {fmtClock(left)}</div>
          <OneupEstimate pending={pending} carry={carry} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-lg font-extrabold">Your Extra Lives <span className="num">({lives.length})</span></div>
        <button
          className="btn btn-accent"
          disabled={claimable === 0n}
          onClick={() =>
            run(`Claim $${fmtUsdc(claimable)}`, () => tx.claimLives(lives.filter((l) => BigInt(l.claimable) > 0n).map((l) => l.token_id)))
          }
        >
          <Icon name="claim" />
          Claim ${fmtUsdc(claimable)}
        </button>
      </div>

      {lives.length === 0 && <p className="label">No Extra Lives yet. Lose a trade and wait for the epoch to end.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lives.map((l) => (
          <LifeCard key={l.token_id} l={l} expiry={expiry} listings={listings} />
        ))}
      </div>
    </div>
  );
}

/** Your share of this epoch's $1UP release if it closed now: 20 per $1 of house profit so far, by loss. */
function OneupEstimate({ pending, carry }: { pending?: string; carry?: string }) {
  const { o } = useOneUp();
  const epoch = usePoll(() => o.epoch(), []);
  if (!pending || !epoch || carry === undefined || BigInt(pending) === 0n) return null;
  const losses = BigInt(epoch.losses);
  const net = losses > BigInt(epoch.payouts) ? losses - BigInt(epoch.payouts) : 0n;
  const release = releasedEmissions(BigInt(carry) + emissionsForEpoch(BigInt(epoch.id)), net);
  const mine = losses > 0n ? (release * BigInt(pending)) / losses : 0n;
  return (
    <div className="label num mt-1">
      {mine > 0n ? `plus about ${fmtOneup(mine.toString())} $1UP, locked for 2 years` : "no $1UP unless the house ends in profit"}
    </div>
  );
}

function LifeCard({ l, expiry, listings }: { l: LifeInfo; expiry?: number; listings: Listing[] }) {
  const { d } = useOneUp();
  const owed = BigInt(l.owed);
  const paid = BigInt(l.paid);
  const progress = owed === 0n ? 0 : Number((paid * 10_000n) / owed) / 10_000;
  const state = l.full_heal ? "Full Heal" : l.expired ? "Expired" : "Extra Life";
  return (
    <div className="panel p-4" style={l.expired && !l.full_heal ? { opacity: 0.7 } : undefined}>
      <div className="flex items-center gap-3">
        <PixelHeart size={44} fill={l.full_heal ? 1 : Math.max(0.12, progress)} label={`${state}, ${(progress * 100).toFixed(0)}% paid`} />
        <div className="flex-1">
          <div className="text-lg font-extrabold leading-tight">{state}</div>
          <div className="label">{l.epoch === 0 ? "Seed life" : `From epoch ${l.epoch}`}</div>
        </div>
        <div className="text-right">
          <div className="display num text-xl">${fmtUsdc(BigInt(l.claimable))}</div>
          <div className="label">to claim</div>
        </div>
      </div>
      <div className="mt-3">
        <HealthBar value={progress} label="Paid toward Full Heal" />
        <div className="label num mt-1.5 flex justify-between">
          <span>
            ${fmtUsdc(paid)} of ${fmtUsdc(owed)}
          </span>
          <span>{(progress * 100).toFixed(1)}% to Full Heal</span>
        </div>
      </div>
      <dl className="num mt-3 grid grid-cols-2 gap-y-1 border-t border-dashed border-[var(--line)] pt-3 text-sm">
        <dt className="label">Face value</dt>
        <dd className="text-right">${fmtUsdc(BigInt(l.face))}</dd>
        <dt className="label">Cap</dt>
        <dd className="text-right">{ppmToNumber(BigInt(l.cap_ppm)).toFixed(2)}×</dd>
        {l.epoch > 0 && expiry !== undefined && !l.full_heal && (
          <>
            <dt className="label">{l.expired ? "Stopped earning" : "Earns through"}</dt>
            <dd className="text-right">epoch {l.epoch + expiry}</dd>
          </>
        )}
      </dl>
      {lifeValue(l) > 0n && <Sell nft={d.contracts.life} tokenId={l.token_id} suggested={(lifeValue(l) * 7n) / 10n} listings={listings} />}
    </div>
  );
}
