"use client";

// The marketplace: Extra Lives and $1UP locks for sale, priced in USDC, with what each is worth.

import { fmtUsdc, type LifeInfo, type Listing, type LockInfo } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lifeValue, lockValue, useOneupPrice } from "@/lib/value";
import { fmtOneup } from "./Header";
import { PixelHeart } from "./Pixel";
import { useListings } from "./Sell";
import { Icon } from "./Icon";

export function Market() {
  const { o, d, me } = useOneUp();
  const listings = useListings();
  const px = useOneupPrice();
  const wallet = usePoll(() => o.usdcBalance(me), [me]);
  const lives = listings.filter((l) => l.nft_contract === d.contracts.life);
  const locks = listings.filter((l) => l.nft_contract === d.contracts.ve);

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-lg font-extrabold">Market</div>
          <p className="label mt-1 max-w-2xl">
            Buy someone&apos;s Extra Life and its USDC payouts are yours. Buy a lock and you get its $1UP when it ends,
            and its share of buybacks until then. Paid from your wallet&apos;s USDC; the NFT moves to you in the same step.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="label">Wallet</div>
          <div className="display num text-xl">${wallet ? fmtUsdc(BigInt(wallet), 0) : "…"}</div>
        </div>
      </div>

      <Section title="Extra Lives" empty="No Extra Lives for sale.">
        {lives.map((l) => (
          <LifeRow key={l.token_id} l={l} />
        ))}
      </Section>
      <Section title="$1UP locks" empty="No locks for sale.">
        {locks.map((l) => (
          <LockRow key={l.token_id} l={l} px={px} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-lg font-extrabold">{title}</div>
      {children.length === 0 ? <p className="label">{empty}</p> : <div className="grid gap-3 md:grid-cols-2">{children}</div>}
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
