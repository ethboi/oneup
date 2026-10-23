"use client";

import { useEffect, useRef, useState } from "react";
import { fmtUsdc, previewLossEmission, type LifeInfo, type Listing } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lifeEconomics, lifeEarningLabel } from "@/lib/life-economics";
import { groupLives, lifeClaimBatch, lifeFromHash, lifeHref } from "@/lib/recovery-journey";
import { fmtClock, fmtOneup, fmtUsd as money, useNow } from "./Header";
import { Icon } from "./Icon";
import { PixelHeart } from "./Pixel";
import { Sell, useListings } from "./Sell";
import { LifeDetail } from "./LifeDetail";
import { Empty, Explainer, PanelHead, Stat, SummaryBar } from "./ui";

export function Lives() {
  const { o, d, me, tx, run } = useOneUp();
  const lives = usePoll(() => o.lives(me), [me]);
  const expiry = usePoll(() => o.params(), [], 60_000)?.life_expiry_epochs;
  const epoch = usePoll(() => o.epoch(), []);
  const last = usePoll(() => (epoch && epoch.id > 1 ? o.epochSummary(epoch.id - 1) : Promise.resolve(null)), [epoch?.id]);
  const listings = useListings();
  const [showDone, setShowDone] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const lastSelected = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const read = () => setSelected(lifeFromHash(location.hash));
    read();
    window.addEventListener("popstate", read);
    window.addEventListener("hashchange", read);
    return () => { window.removeEventListener("popstate", read); window.removeEventListener("hashchange", read); };
  }, []);
  useEffect(() => {
    if (selected) lastSelected.current = selected;
    else if (lastSelected.current && list.current) {
      const link = Array.from(list.current.querySelectorAll<HTMLAnchorElement>("a[data-life-id]")).find(a => a.dataset.lifeId === lastSelected.current);
      (link ?? list.current).focus();
    }
  }, [selected]);
  const openLife = (tokenId: string) => {
    history.pushState(null, "", lifeHref(tokenId));
    setSelected(tokenId);
    window.scrollTo({ top: 0 });
  };
  const closeLife = () => {
    history.pushState(null, "", "/extra-lives");
    setSelected(null);
  };
  const { claimable: ready, earning, finished } = groupLives(lives ?? []);
  const batch = lifeClaimBatch(lives ?? []);
  const conditionalCap = (lives ?? []).reduce((sum, life) => sum + lifeEconomics(life, epoch?.id, expiry).additionalCap, 0n);
  const allocated = (lives ?? []).reduce((sum, life) => sum + BigInt(life.paid), 0n);
  const claimable = (lives ?? []).reduce((sum, life) => sum + BigInt(life.claimable), 0n);
  const rows = (items: LifeInfo[]) => items.map(l => <LifeRow key={l.token_id} l={l} expiry={expiry} currentEpoch={epoch?.id} listings={listings} open={openLife} />);

  if (selected) return <LifeDetail key={selected} tokenId={selected} onBack={closeLife} />;

  return (
    <div ref={list} tabIndex={-1} className="flex flex-col gap-5">
      <Explainer title="Extra Lives" line="Your recovery NFTs: claim earned USDC, inspect their remaining earning rights, or choose a sale price.">
        Eligible net losses in profitable rounds create Extra Lives. A Life&apos;s face value is its share of that round&apos;s house profit, with a cap on how much it can receive. Each round, 60% of half the surplus above the reserve is shared across earning Lives, subject to their caps and available profit. Recovery can be zero.
        {expiry === undefined ? " Earning windows follow the contract's expiry settings." : ` A recovery Life earns in its mint round and up to ${expiry} more rounds, then keeps any unclaimed USDC.`}
        Selling transfers that USDC and the remaining rights to the buyer. A buyer is required; the cap is not a valuation.
      </Explainer>

      <div className="panel divide-y divide-[var(--line)]">
        <SummaryBar action={
          <div className="flex flex-col gap-1">
            <button className="btn btn-accent w-full sm:w-auto" disabled={batch.amount === 0n} onClick={() => run(`Claim $${fmtUsdc(batch.amount)} from ${batch.tokenIds.length} Lives`, () => tx.claimLives(batch.tokenIds))}>
              <Icon name="claim" />{batch.amount > 0n ? `${batch.remainingCount > 0 ? "Claim next 30" : "Claim all"} $${fmtUsdc(batch.amount)}` : "Nothing to claim yet"}
            </button>
            {batch.remainingCount > 0 && <span className="label">{batch.remainingCount} more claimable Lives after this batch</span>}
          </div>
        }>
          <Stat label="Claimable now" value={lives ? money(claimable) : "…"} tone={claimable > 0n ? "good" : undefined} />
          <Stat label="Additional conditional cap" value={lives ? money(conditionalCap) : "…"} sub="Not guaranteed; future earnings may be zero" />
          <Stat label="Allocated to these NFTs" value={lives ? money(allocated) : "…"} sub="Lifetime total, including earlier owners" />
          <Stat label="Last round, to all Lives" value={last ? money(BigInt(last.lives_pot)) : "–"} />
        </SummaryBar>
        <NextLife epochId={epoch?.id} left={epoch ? epoch.started_at + d.epochLengthS : 0} />
        {lives === undefined ? <Empty icon="heart">Loading your Extra Lives…</Empty> : <>
          {ready.length > 0 && <div className="divide-y divide-[var(--line)]"><PanelHead title={`Ready to claim (${ready.length})`} /><p className="px-4 pb-2 text-sm text-[var(--muted)]">Includes finished Lives with unclaimed USDC. Open a Life to claim individually or review its sale.</p>{rows(ready)}</div>}
          <div className="divide-y divide-[var(--line)]">
            <PanelHead title={`Awaiting future payouts (${earning.length})`} />
            {earning.length === 0 ? <Empty icon="heart">{ready.length ? "Your other Lives have no remaining earning rights." : "No Lives awaiting payouts. Eligible net losses in a profitable round can receive one when the round settles."}</Empty> : rows(earning)}
          </div>
          {finished.length > 0 && <div className="divide-y divide-[var(--line)]"><PanelHead title={`Finished · nothing to claim (${finished.length})`} action={<button className="chip" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>{showDone ? "Hide" : "Show"}</button>} />{showDone && rows(finished)}</div>}
        </>}
      </div>
    </div>
  );
}

/** This round's loss is only a candidate entitlement until final settlement. */
function NextLife({ epochId, left }: { epochId?: number; left: number }) {
  const { o, me } = useOneUp();
  const pending = usePoll(() => o.pendingLife(me), [me]);
  const carry = usePoll(() => o.emissionCarry(), []);
  const epoch = usePoll(() => o.epoch(), []);
  const params = usePoll(() => o.params(), []);
  const now = useNow();
  const lost = pending ? BigInt(pending) : 0n;
  let oneup = 0n;
  if (epoch && carry !== undefined && lost > 0n) oneup = previewLossEmission(epoch, BigInt(carry), lost, BigInt(params?.oneup_per_usdc ?? 20));
  return <div className="flex items-center gap-3 bg-[var(--panel-2)] px-4 py-3"><PixelHeart size={28} fill={lost > 0n ? 0.5 : 0} /><div className="min-w-0 flex-1 text-sm"><b>Potential Extra Life, round {epochId ?? "…"}</b><div className="label num">{pending === undefined ? "Checking this account's unsettled loss…" : lost > 0n ? `$${fmtUsdc(lost)} net loss so far${oneup > 0n ? `, plus about ${fmtOneup(oneup.toString())} $1UP if settled now` : ""}. Round ends in ${fmtClock(Math.max(0, left - now))}; eligibility and amounts depend on final house profit.` : `Nothing lost this round. It closes in ${fmtClock(Math.max(0, left - now))}.`}</div></div></div>;
}

function LifeRow({ l, expiry, currentEpoch, listings, open }: { l: LifeInfo; expiry?: number; currentEpoch?: number; listings: Listing[]; open: (id: string) => void }) {
  const { d } = useOneUp();
  const economics = lifeEconomics(l, currentEpoch, expiry);
  const owed = BigInt(l.owed);
  const progress = owed === 0n ? 0 : Number((economics.allocated * 10_000n) / owed) / 10_000;
  return <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)_8rem_10rem_11rem]">
    <PixelHeart size={34} fill={progress} live={economics.canReceiveMore} />
    <div className="min-w-0"><a href={lifeHref(l.token_id)} data-life-id={l.token_id} className="font-extrabold text-[var(--primary)] underline underline-offset-2" onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); open(l.token_id); }}>{l.backer ? `Backer Life #${l.token_id}` : `Recovery Life · round ${l.epoch}`}</a><div className="label mt-1 break-all">Token {l.token_id}</div><div className="label mt-1">{lifeEarningLabel(l, currentEpoch, expiry)}</div></div>
    <div className="col-start-2 sm:col-start-auto"><div className="num font-extrabold" style={economics.claimable > 0n ? { color: "var(--long)" } : undefined}>{money(economics.claimable)}</div><div className="label">claimable now</div></div>
    <div className="col-start-2 sm:col-start-auto"><div className="num font-extrabold">{money(economics.additionalCap)}</div><div className="label">additional conditional cap</div></div>
    <div className="col-start-2 sm:col-start-auto">{economics.hasRecoverableFunds && <Sell nft={d.contracts.life} tokenId={l.token_id} listings={listings} compact />}</div>
  </div>;
}
