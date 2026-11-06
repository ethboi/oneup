"use client";

import { useEffect, useRef } from "react";
import { fmtUsdc, ppmToNumber } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lifeEconomics } from "@/lib/life-economics";
import { fmtUsd as money } from "./Header";
import { HealthBar } from "./Pixel";
import { LifeCard, lifeState } from "./LifeCard";
import { Icon } from "./Icon";
import { Sell, useListings } from "./Sell";
import { OnExplorer, Stat } from "./ui";

/** Poll this token independently of the selected wallet, so a transfer never hides its new owner. */
export function LifeDetail({ tokenId, onBack }: { tokenId: string; onBack: () => void }) {
  const { o, d, me, tx, run } = useOneUp();
  const life = usePoll(() => o.lifeInfo(tokenId), [tokenId, me]);
  const params = usePoll(() => o.params(), [], 60_000);
  const epoch = usePoll(() => o.epoch(), []);
  const listings = useListings();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, [tokenId, life === undefined]);
  const back = <button className="btn btn-ghost self-start" onClick={onBack}>← All Life NFTs</button>;
  if (life === undefined) return <section className="flex flex-col gap-4">{back}<h1 ref={title} tabIndex={-1} className="page-title">Loading Life…</h1></section>;
  if (!life) return <section className="flex flex-col gap-4">{back}<h1 ref={title} tabIndex={-1} className="page-title">Life not found</h1><p className="text-sm text-[var(--muted)]">No Life with token ID {tokenId} was found on this network.</p></section>;

  const economics = lifeEconomics(life, epoch?.id, params?.life_expiry_epochs);
  const mine = life.owner_id === me;
  const owed = BigInt(life.owed);
  const progress = owed > 0n ? Number((economics.allocated * 10_000n) / owed) / 10_000 : 0;
  const expiry = life.backer ? "No expiry (Backer Life)" : economics.lastEarningEpoch === null ? "Loading earning period…" : `Rounds ${life.epoch} to ${economics.lastEarningEpoch}, inclusive`;
  const status = economics.status === "expired" ? "Earning period ended" : economics.status === "fully-allocated" ? "Maximum payout reached" : economics.status === "awaiting-settlement" ? "Earning period ended; final settlement pending" : economics.remainingEarningRounds === null ? "Future payouts depend on house profit" : `${economics.remainingEarningRounds} earning round${economics.remainingEarningRounds === 1 ? "" : "s"} left, including this round`;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="life-detail-title">
      {back}
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-end">
        <LifeCard
          className="w-[200px] shrink-0"
          id={life.backer ? life.token_id : String(life.epoch)}
          paid={BigInt(life.paid)}
          owed={owed}
          state={lifeState(life)}
          backer={life.backer}
          tone={life.backer ? "backer" : "recovery"}
          tag={life.backer ? "BACKER" : "LOSS"}
          detail={life.backer ? "House pool" : `Round ${life.epoch}`}
          amount={`${money(BigInt(life.paid))} / ${money(owed)}`}
        />
        <div className="min-w-0 self-stretch sm:self-auto sm:pb-2">
          <h1 id="life-detail-title" ref={title} tabIndex={-1} className="page-title">{life.backer ? "Backer Life" : `Life NFT · round ${life.epoch}`}</h1>
          <p className="mt-1 break-all text-sm text-[var(--muted)]">Token ID: <span className="num">{life.token_id}</span> <OnExplorer nft={{ contract: d.contracts.life, id: life.token_id }} /></p>
        </div>
      </div>
      <div className="panel divide-y divide-[var(--line)]">
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Stat label="Available to claim" value={money(economics.claimable)} tone={economics.claimable > 0n ? "good" : undefined} sub="USDC already allocated to this Life" />
          <Stat label="Remaining payout limit" value={money(economics.additionalCap)} sub="Maximum additional USDC. Future payouts may be zero." />
        </div>
        <div className="p-5">
          <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
            <div><dt className="label">Current owner</dt><dd className="mt-1 break-all font-semibold">{life.owner_id}{mine ? " (you)" : ""} <OnExplorer account={life.owner_id} /></dd></div>
            <div><dt className="label">Issued for round</dt><dd className="mt-1 font-semibold">{life.epoch}{life.backer ? " · pool backing" : " · eligible net trading loss"}</dd></div>
            <div><dt className="label">Earning period</dt><dd className="mt-1 font-semibold">{expiry}</dd><dd className="mt-1 text-[var(--muted)]">{status}</dd></div>
            <div><dt className="label">Maximum total payout</dt><dd className="mt-1 font-semibold">{money(owed)} · face value {money(BigInt(life.face))} × {ppmToNumber(BigInt(life.cap_ppm)).toFixed(2)}</dd><dd className="mt-1 text-[var(--muted)]">This is a payout limit, not a guaranteed return or a sale price.</dd></div>
          </dl>
        </div>
        <div className="space-y-3 p-5">
          <h2 className="font-extrabold">Claim USDC or list for sale</h2>
          {mine ? (
            <>
              <p className="text-sm text-[var(--muted)]">Claim USDC already allocated to this Life. If someone buys it, they receive the NFT, its unclaimed USDC and any remaining payout rights.</p>
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <button className="btn btn-accent" disabled={economics.claimable === 0n} onClick={() => run(`Claim $${fmtUsdc(economics.claimable)} from Life ${life.token_id}`, () => tx.claimLives([life.token_id]))}>
                  <Icon name="claim" />{economics.claimable > 0n ? `Claim $${fmtUsdc(economics.claimable)}` : "No USDC to claim"}
                </button>
                {economics.hasRecoverableFunds && <div className="min-w-0 sm:min-w-64"><Sell key={`${me}:${life.token_id}`} nft={d.contracts.life} tokenId={life.token_id} listings={listings} compact /></div>}
              </div>
              {listings.some(l => l.nft_contract === d.contracts.life && l.token_id === life.token_id) && <p className="text-xs text-[var(--muted)]">Claiming USDC makes the current listing invalid. Select Update price to list it again. Any purchase using the old listing is refunded.</p>}
            </>
          ) : <p className="text-sm text-[var(--muted)]">This Life belongs to {life.owner_id}. Only the current owner can claim USDC or list it for sale. You are using {me}. <a className="font-semibold text-[var(--primary)] underline" href="/market">View the market</a>.</p>}
        </div>
        <div className="space-y-3 p-5">
          <h2 className="font-extrabold">Lifetime totals</h2>
          <HealthBar value={progress} label="USDC allocated toward the maximum payout" />
          <div className="grid grid-cols-2 gap-4"><Stat label="Total USDC allocated" value={money(economics.allocated)} /><Stat label="Total USDC withdrawn" value={money(economics.withdrawn)} /></div>
          <p className="text-sm text-[var(--muted)]">These totals cover this Life across all owners, so they do not show your personal profit. A transaction history for individual Life NFTs is not available.</p>
        </div>
      </div>
    </section>
  );
}
