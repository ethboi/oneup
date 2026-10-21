"use client";

// The marketplace: Extra Lives and $1UP locks for sale, priced in USDC, with what each is worth.

import { USDC, fmtUsdc, type LifeInfo, type Listing, type LockInfo } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lifeValue, lockValue, useOneupPrice } from "@/lib/value";
import { fmtOneup } from "./Header";
import { PixelHeart } from "./Pixel";
import { Sell, useListings } from "./Sell";
import { ActivityList, useActivity } from "./Activity";
import { Empty, Explainer, Section } from "./ui";
import { Icon } from "./Icon";

export function Market() {
  const { o, d, me } = useOneUp();
  const listings = useListings();
  const px = useOneupPrice();
  const wallet = usePoll(() => o.usdcBalance(me), [me]);
  const sales = useActivity(100).filter((a) => a.kind === "sold");
  const lives = listings.filter((l) => l.nft_contract === d.contracts.life);
  const locks = listings.filter((l) => l.nft_contract === d.contracts.ve);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-5">
        <Explainer line={<>Buy and sell Extra Lives and $1UP locks for USDC. You have <b className="num text-[var(--text)]">${wallet ? fmtUsdc(BigInt(wallet), 0) : "…"}</b> in your wallet.</>}>
          Buy someone&apos;s Extra Life and its USDC payouts are yours. Buy a lock and you get its $1UP when it ends, and its share
          of buybacks until then. You pay from your wallet&apos;s USDC and the NFT moves to you in the same step; if it was
          sold elsewhere first, your USDC comes straight back. There are no fees.
        </Explainer>

        {lives.length + locks.length === 0 ? (
          <Section title="Nothing for sale right now">
            <YourItems px={px} listings={listings} />
          </Section>
        ) : (
          <>
            <Section title={`Extra Lives (${lives.length})`}>
              {lives.length === 0 ? <p className="label">None listed.</p> : <div className="grid gap-3 md:grid-cols-2">{lives.map((l) => <LifeRow key={l.token_id} l={l} />)}</div>}
            </Section>
            <Section title={`$1UP locks (${locks.length})`}>
              {locks.length === 0 ? <p className="label">None listed.</p> : <div className="grid gap-3 md:grid-cols-2">{locks.map((l) => <LockRow key={l.token_id} l={l} px={px} />)}</div>}
            </Section>
          </>
        )}
      </div>

      <Section title="Recent sales">
        <div className="panel p-4">
          <ActivityList items={sales} limit={10} empty="No sales yet." />
        </div>
      </Section>
    </div>
  );
}

/** When the market is empty: what you could list, with the same Sell control as the Lives and Locks tabs. */
function YourItems({ px, listings }: { px: bigint; listings: Listing[] }) {
  const { o, d, me } = useOneUp();
  const lives = (usePoll(() => o.lives(me), [me]) ?? []).filter((l) => lifeValue(l) > 0n);
  const locks = (usePoll(() => o.locks(me), [me]) ?? []).filter((l) => !l.withdrawn);
  if (lives.length + locks.length === 0) {
    return (
      <div className="panel">
        <Empty icon="store">Nothing listed, and you have nothing to sell yet. Extra Lives and $1UP locks arrive when you lose a trade.</Empty>
      </div>
    );
  }
  return (
    <div className="panel divide-y divide-[var(--line)]">
      <p className="label p-3">List one of yours. Suggested prices are 70% of what a life can still pay and 80% of a lock&apos;s value if left today.</p>
      {lives.map((l) => (
        <div key={l.token_id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <PixelHeart size={24} />
            <span className="min-w-0">
              <b className="block">Extra Life from epoch {l.epoch}</b>
              <span className="label num">${fmtUsdc(lifeValue(l), 0)} still to pay</span>
            </span>
          </span>
          <div className="sm:w-56">
            <Sell nft={d.contracts.life} tokenId={l.token_id} suggested={(lifeValue(l) * 7n) / 10n} listings={listings} compact />
          </div>
        </div>
      ))}
      {locks.map((l) => (
        <div key={l.token_id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <Icon name="lock" size={22} />
            <span className="min-w-0">
              <b className="block num">{fmtOneup(l.amount)} $1UP lock</b>
              <span className="label num">{px > 0n ? `$${fmtUsdc(lockValue(l, px), 0)} if left today` : `unlocks at epoch ${l.end}`}</span>
            </span>
          </span>
          <div className="sm:w-56">
            <Sell nft={d.contracts.ve} tokenId={l.token_id} suggested={px > 0n ? (lockValue(l, px) * 8n) / 10n : USDC} listings={listings} compact />
          </div>
        </div>
      ))}
    </div>
  );
}

function LifeRow({ l }: { l: Listing }) {
  const { o } = useOneUp();
  const info = usePoll(() => o.lifeInfo(l.token_id), [l.token_id], 10_000);
  const progress = info && BigInt(info.owed) > 0n ? Number((BigInt(info.paid) * 10_000n) / BigInt(info.owed)) / 10_000 : 0;
  return (
    <Row
      l={l}
      icon={<PixelHeart size={36} fill={info?.full_heal ? 1 : Math.max(0.12, progress)} />}
      title={info ? `Extra Life from epoch ${info.epoch}` : "Extra Life"}
      detail={info ? lifeDetail(info) : "…"}
      worth={info ? lifeValue(info) : undefined}
      worthLabel="USDC still to pay"
    />
  );
}

function lifeDetail(i: LifeInfo) {
  const state = i.expired ? "expired" : i.full_heal ? "fully healed" : "earning";
  return `$${fmtUsdc(BigInt(i.paid), 0)} of $${fmtUsdc(BigInt(i.owed), 0)} paid, ${state}`;
}

function LockRow({ l, px }: { l: Listing; px: bigint }) {
  const { o } = useOneUp();
  const info = usePoll(() => o.lockInfo(l.token_id), [l.token_id], 10_000);
  return (
    <Row
      l={l}
      icon={<span className="display flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--edge)] bg-[var(--accent)] text-[var(--on-color)]">1UP</span>}
      title={info ? `${fmtOneup(info.amount)} $1UP lock` : "$1UP lock"}
      detail={info ? lockDetail(info) : "…"}
      worth={info && px > 0n ? lockValue(info, px) : undefined}
      worthLabel="if left today"
    />
  );
}

function lockDetail(i: LockInfo) {
  return `Unlocks at epoch ${i.end}, weight ${fmtOneup(i.power)}`;
}

function Row({ l, icon, title, detail, worth, worthLabel }: { l: Listing; icon: React.ReactNode; title: string; detail: string; worth?: bigint; worthLabel: string }) {
  const { me, tx, run } = useOneUp();
  const price = BigInt(l.price);
  const discount = worth && worth > 0n ? Math.round((1 - Number(price) / Number(worth)) * 100) : null;
  const mine = l.seller === me;
  return (
    <div className="panel flex items-center gap-3 p-3">
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-extrabold">{title}</div>
        <div className="label truncate">{detail}</div>
        <div className="label num">
          {worth !== undefined ? `Worth $${fmtUsdc(worth, 0)} ${worthLabel}` : ""}
          {discount !== null && discount > 0 ? `, ${discount}% off` : ""}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="display num text-lg">${fmtUsdc(price, 0)}</span>
        {mine ? (
          <button className="btn btn-ghost px-3 py-1" onClick={() => run("Take down listing", () => tx.delist(l.nft_contract, l.token_id))}>
            Take down
          </button>
        ) : (
          <button className="btn btn-accent px-3 py-1" onClick={() => run(`Buy for $${fmtUsdc(price, 0)}`, () => tx.buy(l.nft_contract, l.token_id, price))}>
            <Icon name="cart" size={15} />
            Buy
          </button>
        )}
      </div>
    </div>
  );
}
