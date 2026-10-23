"use client";

import { useEffect, useRef } from "react";
import { fmtUsdc, ppmToNumber } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lifeEconomics } from "@/lib/life-economics";
import { fmtUsd as money } from "./Header";
import { PixelHeart, HealthBar } from "./Pixel";
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
  const back = <button className="btn btn-ghost self-start" onClick={onBack}>← All Extra Lives</button>;
  if (life === undefined) return <section className="flex flex-col gap-4">{back}<h1 ref={title} tabIndex={-1} className="page-title">Loading Life…</h1></section>;
  if (!life) return <section className="flex flex-col gap-4">{back}<h1 ref={title} tabIndex={-1} className="page-title">Life not found</h1><p className="text-sm text-[var(--muted)]">No NFT with token ID {tokenId} exists on this deployment.</p></section>;

  const economics = lifeEconomics(life, epoch?.id, params?.life_expiry_epochs);
  const mine = life.owner_id === me;
  const owed = BigInt(life.owed);
  const progress = owed > 0n ? Number((economics.allocated * 10_000n) / owed) / 10_000 : 0;
  const expiry = life.backer ? "No expiry (Backer Life)" : economics.lastEarningEpoch === null ? "Loading expiry parameters…" : `Through round ${economics.lastEarningEpoch}, including the mint round`;
  const status = economics.status === "expired" ? "Earning period ended" : economics.status === "fully-allocated" ? "Full cap allocated" : economics.status === "awaiting-settlement" ? "Earning window ended; awaiting settlement" : economics.remainingEarningRounds === null ? "Future payouts depend on house profit" : `${economics.remainingEarningRounds} eligible earning rounds left, including the current round`;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="life-detail-title">
      {back}
      <div className="flex items-center gap-4">
        <PixelHeart size={46} fill={progress} live={economics.canReceiveMore} />
        <div className="min-w-0">
          <h1 id="life-detail-title" ref={title} tabIndex={-1} className="page-title">{life.backer ? "Backer Life" : `Recovery Life · round ${life.epoch}`}</h1>
          <p className="mt-1 break-all text-sm text-[var(--muted)]">Token ID: <span className="num">{life.token_id}</span> <OnExplorer nft={{ contract: d.contracts.life, id: life.token_id }} /></p>
        </div>
      </div>
      <div className="panel divide-y divide-[var(--line)]">
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Stat label="Claimable USDC now" value={money(economics.claimable)} tone={economics.claimable > 0n ? "good" : undefined} sub="Already allocated to this NFT" />
          <Stat label="Additional conditional cap" value={money(economics.additionalCap)} sub="Maximum additional USDC; may earn zero" />
        </div>
        <div className="p-5">
          <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
            <div><dt className="label">Current owner</dt><dd className="mt-1 break-all font-semibold">{life.owner_id}{mine ? " (you)" : ""} <OnExplorer account={life.owner_id} /></dd></div>
            <div><dt className="label">Originating round</dt><dd className="mt-1 font-semibold">{life.epoch}{life.backer ? " · pool backing" : " · eligible net trading loss"}</dd></div>
            <div><dt className="label">Earning window</dt><dd className="mt-1 font-semibold">{expiry}</dd><dd className="mt-1 text-[var(--muted)]">{status}</dd></div>
            <div><dt className="label">Original payout cap</dt><dd className="mt-1 font-semibold">{money(owed)} · face {money(BigInt(life.face))} × {ppmToNumber(BigInt(life.cap_ppm)).toFixed(2)}</dd><dd className="mt-1 text-[var(--muted)]">A limit on recovery, never a promised return or a market price.</dd></div>
          </dl>
        </div>
        <div className="space-y-3 p-5">
          <h2 className="font-extrabold">Claim or sell this Life</h2>
          {mine ? (
            <>
              <p className="text-sm text-[var(--muted)]">Claiming sends the earned USDC to your wallet. Selling transfers ownership, all unclaimed USDC, and any remaining earning rights to the buyer. A sale needs a buyer.</p>
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <button className="btn btn-accent" disabled={economics.claimable === 0n} onClick={() => run(`Claim $${fmtUsdc(economics.claimable)} from Life ${life.token_id}`, () => tx.claimLives([life.token_id]))}>
                  <Icon name="claim" />{economics.claimable > 0n ? `Claim $${fmtUsdc(economics.claimable)}` : "No USDC to claim yet"}
                </button>
                {economics.hasRecoverableFunds && <div className="min-w-0 sm:min-w-64"><Sell key={`${me}:${life.token_id}`} nft={d.contracts.life} tokenId={life.token_id} listings={listings} compact /></div>}
              </div>
              {listings.some(l => l.nft_contract === d.contracts.life && l.token_id === life.token_id) && <p className="text-xs text-[var(--muted)]">Claiming USDC invalidates this listing’s sale approval. Use Re-price to approve a fresh listing afterwards. A purchase using the old approval is refunded.</p>}
            </>
          ) : <p className="text-sm text-[var(--muted)]">This Life belongs to {life.owner_id}. Only its current owner can claim or list it. Your selected account is {me}. <a className="font-semibold text-[var(--primary)] underline" href="/market">View the market</a>.</p>}
        </div>
        <div className="space-y-3 p-5">
          <h2 className="font-extrabold">NFT totals</h2>
          <HealthBar value={progress} label="USDC allocated toward the original cap" />
          <div className="grid grid-cols-2 gap-4"><Stat label="Allocated over this NFT's lifetime" value={money(economics.allocated)} /><Stat label="Already withdrawn by owners" value={money(economics.withdrawn)} /></div>
          <p className="text-sm text-[var(--muted)]">These are current contract totals for the NFT, across all owners. They are not your personal profit. A per-NFT transaction timeline is not available; account activity cannot reliably attribute every claim to a token.</p>
        </div>
      </div>
    </section>
  );
}
