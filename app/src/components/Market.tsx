"use client";

// The marketplace keeps the asking price separate from current funds and conditional future entitlements.

import { useState } from "react";
import { type LifeInfo, type Listing, type LockInfo } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lockValue, useOneupPrice } from "@/lib/value";
import { lifeEconomics, lifeEarningLabel } from "@/lib/life-economics";
import { compareAskingPrices, listingPriceInput, listingsPollKey, type AskingPriceOrder } from "@/lib/market-pricing";
import { lifeHref } from "@/lib/recovery-journey";
import { fmtOneup, fmtUsd } from "./Header";
import { PixelHeart, PixelLock } from "./Pixel";
import { Sell, useListings } from "./Sell";
import { useActivity, type ActivityItem } from "./Activity";
import { Explainer, PanelHead } from "./ui";
import { Icon } from "./Icon";

type Item =
  | { kind: "life"; l: Listing; info: LifeInfo }
  | { kind: "lock"; l: Listing; info: LockInfo; value: bigint };

type Filter = "all" | "life" | "lock";
type Sort = AskingPriceOrder;

/** Prices in cents under $100, whole dollars above. */
const usd = (x: bigint) => fmtUsd(x);

export function Market() {
  const { o, d, me } = useOneUp();
  const listings = useListings();
  const px = useOneupPrice();
  const wallet = BigInt(usePoll(() => o.usdcBalance(me), [me]) ?? "0");
  const epoch = usePoll(() => o.epoch(), [], 10_000);
  const params = usePoll(() => o.params(), [], 60_000);
  const sales = useActivity(100).filter((a) => a.kind === "sold");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("cheap");

  // Expired Lives can still carry claimable USDC, which transfers with the NFT.
  const key = listingsPollKey(listings);
  const items = usePoll(
    async () => {
      const got = await Promise.all(
        listings.map(async (l): Promise<Item | null> => {
          if (l.nft_contract === d.contracts.life) {
            const info = await o.lifeInfo(l.token_id).catch(() => null);
            return info && lifeEconomics(info).hasRecoverableFunds ? { kind: "life", l, info } : null;
          }
          if (l.nft_contract === d.contracts.ve) {
            const info = await o.lockInfo(l.token_id).catch(() => null);
            return info && !info.withdrawn ? { kind: "lock", l, info, value: px > 0n ? lockValue(info, px) : 0n } : null;
          }
          return null;
        }),
      );
      return got.filter((x): x is Item => x !== null);
    },
    [key, px.toString()],
    10_000,
  );
  // all locks' weight this round, for each lock's share of a buyback
  const totalPower = usePoll(() => (epoch ? o.totalPower(epoch.id) : Promise.resolve("0")), [epoch?.id], 30_000);

  const all = items ?? [];
  const shown = all
    .filter((x) => filter === "all" || x.kind === filter)
    .sort((a, b) => compareAskingPrices(a.l, b.l, sort));
  const lives = all.filter((x) => x.kind === "life").length;
  const locks = all.length - lives;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-5">
        <Explainer title="Market" line={<>Buy or list Extra Lives and $1UP locks for USDC. Your wallet balance: <b className="num text-[var(--text)]">{usd(wallet)}</b>.</>}>
          Buying an Extra Life transfers its unclaimed USDC and remaining payout rights to you. Compare the asking price with both the USDC available to claim and the remaining payout limit. That limit is the maximum additional USDC it could receive; future payouts may be zero and depend on house profit during its earning period.
          Buying a lock transfers its locked $1UP and its share of eligible buybacks. You can unlock its tokens when the lock ends. Estimated withdrawal values use the current $1UP price, after any early exit penalty; they are not USDC payouts.
          Payment and NFT transfer are handled together. If the NFT has already been sold, your USDC is refunded. Sellers pay a 2% fee into the house pool. Balances refresh periodically. If a seller claims before a purchase, the listing becomes invalid. Any purchase using that listing is refunded, and the seller must list it again.
        </Explainer>

        <div className="panel">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] p-3">
            <div className="chip-track" role="group" aria-label="Filter listings">
              {(
                [
                  ["all", `All (${all.length})`],
                  ["life", `Extra Lives (${lives})`],
                  ["lock", `Locks (${locks})`],
                ] as const
              ).map(([k, name]) => (
                <button key={k} type="button" className="chip num" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {name}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="label">Sort</span>
              <select className="bar-select num" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="cheap">Lowest asking price</option>
                <option value="expensive">Highest asking price</option>
              </select>
            </label>
          </div>
          <p className="label border-b border-[var(--line)] px-4 py-2">Future payouts may be zero. If the seller claims first, the listing becomes invalid and any purchase using it is refunded.</p>
          {items === undefined ? (
            <p className="label p-4">Loading…</p>
          ) : shown.length === 0 ? (
            <EmptyMarket filter={filter} />
          ) : (
            <div className="divide-y divide-[var(--line)]">
              {shown.map((x) => (
                <Row key={`${x.l.nft_contract}:${x.l.token_id}`} x={x} wallet={wallet} epoch={epoch?.id} expiryEpochs={params?.life_expiry_epochs} totalPower={totalPower ? BigInt(totalPower) : 0n} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div id="sell" className="panel scroll-mt-4">
          <PanelHead title="List an NFT" />
          <YourItems px={px} listings={listings} epoch={epoch?.id} expiryEpochs={params?.life_expiry_epochs} />
        </div>
        <div className="panel">
          <PanelHead title="Recent sales" />
          <Sales items={sales.slice(0, 10)} />
        </div>
      </div>
    </div>
  );
}

function EmptyMarket({ filter }: { filter: Filter }) {
  const what = filter === "life" ? "Extra Lives" : filter === "lock" ? "$1UP locks" : "Extra Lives or locks";
  return (
    <div className="flex flex-col items-start gap-3 p-5 text-sm">
      <span className="flex items-center gap-3">
        {filter === "lock" ? <PixelLock size={28} /> : <PixelHeart size={28} />}
        <span>
          <b className="block">No {what} for sale right now.</b>
          <span className="label">You can list your Extra Lives and $1UP locks here.</span>
        </span>
      </span>
      <a href="#sell" className="btn btn-ghost">
        <Icon name="tag" size={16} />
        List yours
      </a>
    </div>
  );
}

/** What you could sell (lives that can still pay, locks not yet withdrawn), each with its Sell control. */
function YourItems({ px, listings, epoch, expiryEpochs }: { px: bigint; listings: Listing[]; epoch?: number; expiryEpochs?: number }) {
  const { o, d, me } = useOneUp();
  const lives = (usePoll(() => o.lives(me), [me]) ?? []).filter((l) => lifeEconomics(l).hasRecoverableFunds);
  const locks = (usePoll(() => o.locks(me), [me]) ?? []).filter((l) => !l.withdrawn);
  // the first three, so Recent sales stays in view; the rest on request
  const [all, setAll] = useState(false);
  const total = lives.length + locks.length;
  const shownLives = all ? lives : lives.slice(0, 3);
  const shownLocks = all ? locks : locks.slice(0, Math.max(0, 3 - shownLives.length));
  if (total === 0) {
    return <p className="label px-4 pb-4">You have no Lives or locks to list yet. Eligible net losses in profitable rounds can earn you Extra Lives and $1UP locks.</p>;
  }
  return (
    <div className="divide-y divide-[var(--line)]">
      <p className="label px-4 pb-3">
        Choose your asking price. Payout limits and estimated withdrawal values are not sale prices. A sale needs a buyer; you receive the sale price minus a 2% fee.
      </p>
      {shownLives.map((l) => (
        <div key={l.token_id} className="flex flex-col gap-2 p-3">
          <span className="flex min-w-0 items-center gap-3">
            <PixelHeart size={24} />
            <span className="min-w-0">
              <b className="block">{l.backer ? "Backer Life" : `Extra Life from round ${l.epoch}`}</b>
              <span className="label num block">{usd(lifeEconomics(l).claimable)} available to claim · up to {usd(lifeEconomics(l).additionalCap)} in future payouts</span>
              <span className="label block">{lifeEarningLabel(l, epoch, expiryEpochs)}</span>
            </span>
          </span>
          <Sell nft={d.contracts.life} tokenId={l.token_id} listings={listings} compact />
        </div>
      ))}
      {shownLocks.map((l) => (
        <div key={l.token_id} className="flex flex-col gap-2 p-3">
          <span className="flex min-w-0 items-center gap-3">
            <PixelLock size={22} />
            <span className="min-w-0">
              <b className="block num">{fmtOneup(l.amount)} $1UP lock</b>
              <span className="label num">{px > 0n ? `Estimated value after exit penalty: ${usd(lockValue(l, px))}` : `unlocks in round ${l.end}`}</span>
            </span>
          </span>
          <Sell nft={d.contracts.ve} tokenId={l.token_id} listings={listings} compact />
        </div>
      ))}
      {total > 3 && (
        <button type="button" className="label w-full p-3 text-center font-bold underline decoration-dotted underline-offset-2" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${total}`}
        </button>
      )}
    </div>
  );
}

function Row({ x, wallet, epoch, expiryEpochs, totalPower }: { x: Item; wallet: bigint; epoch?: number; expiryEpochs?: number; totalPower: bigint }) {
  const { me, tx, run } = useOneUp();
  const price = BigInt(x.l.price);
  const askingPrice = `$${listingPriceInput(x.l)}`;
  const mine = x.l.seller === me;
  const short = wallet < price;

  let title: string;
  let detail: string;
  if (x.kind === "life") {
    const i = x.info;
    title = i.backer ? "Backer Life" : `Extra Life from round ${i.epoch}`;
    detail = lifeEarningLabel(i, epoch, expiryEpochs);
  } else {
    const i = x.info;
    title = `${fmtOneup(i.amount)} $1UP lock`;
    const left = epoch === undefined ? null : Math.max(0, i.end - epoch);
    const share = totalPower > 0n ? (Number(BigInt(i.power)) / Number(totalPower)) * 100 : null;
    const cut = share === null ? "" : ` · current buyback share: about ${share < 0.1 ? share.toFixed(2) : share.toFixed(1)}%`;
    detail = left === 0 ? "Ready to unlock: its $1UP can be withdrawn now" : `Unlocks in ${left ?? "…"} round${left === 1 ? "" : "s"}${cut}`;
  }

  return (
    // phones: price and button on their own line under the details
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 sm:flex-nowrap sm:px-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--panel-2)]">
        {x.kind === "life" ? <PixelHeart size={28} fill={x.info.full_heal ? 1 : lifeProgress(x.info)} live={!x.info.full_heal && !x.info.expired} /> : <PixelLock size={24} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <b className="truncate">{title}</b>
        </div>
        {x.kind === "life" ? (
          <div className="mt-1 grid gap-x-5 gap-y-1 text-sm sm:grid-cols-2">
            <span><span className="label block">Available to claim</span><b className="num">{usd(lifeEconomics(x.info).claimable)}</b></span>
            <span><span className="label block">Remaining payout limit</span><b className="num">Up to {usd(lifeEconomics(x.info).additionalCap)}</b></span>
          </div>
        ) : <div className="label num">Estimated value after exit penalty: {usd(x.value)}</div>}
        <div className="label mt-1">{detail}</div>
        <div className="label num break-all">Token {x.l.token_id}</div>
        {x.kind === "life" && <a className="mt-1 inline-block text-sm font-bold underline decoration-dotted underline-offset-2" href={lifeHref(x.l.token_id)}>View Life details</a>}
      </div>
      <div className="flex w-full shrink-0 items-center justify-between gap-2 pl-14 sm:w-auto sm:flex-col sm:items-end sm:gap-1 sm:pl-0">
        <span className="text-right"><span className="label block">Asking price</span><span className="display num text-lg">{askingPrice}</span></span>
        {mine ? (
          <button className="btn btn-ghost px-3 py-1" onClick={() => run("Remove listing", () => tx.delist(x.l.nft_contract, x.l.token_id))}>
            Remove listing
          </button>
        ) : (
          <button
            className="btn btn-accent px-3 py-1"
            disabled={short}
            title={short ? `You need ${usd(price - wallet)} more USDC. Add test USDC from the Demo menu.` : undefined}
            onClick={() => run(`Buy for ${askingPrice}`, () => tx.buy(x.l))}
          >
            <Icon name="cart" size={15} />
            {short ? "Not enough USDC" : "Buy"}
          </button>
        )}
      </div>
    </div>
  );
}

/** How much of a life's cap it has been paid, for its heart (never drawn empty). */
const lifeProgress = (i: LifeInfo) => (BigInt(i.owed) > 0n ? Math.max(0.12, Number((BigInt(i.paid) * 10_000n) / BigInt(i.owed)) / 10_000) : 0.12);

/** Observed sale prices. Historical cap snapshots are not valuations. */
function Sales({ items }: { items: ActivityItem[] }) {
  const { d } = useOneUp();
  if (d.network !== "localnet") return <p className="label px-4 pb-4">Sale history is not indexed on testnet. Current listings still update from the contracts.</p>;
  if (items.length === 0) return <p className="label px-4 pb-4">No sales yet.</p>;
  const now = Date.now();
  return (
    <ul className="divide-y divide-[var(--line)] px-4 pb-1">
      {items.map((a) => {
        const s = a.sale;
        const ago = Math.max(0, Math.round((now - a.t) / 60_000));
        // "bot2 bought bot4's Extra Life for $4.30": the price goes in its own column
        const [, who, price] = a.text.match(/^(.*) for (\$[\d,.]+)$/) ?? [, a.text, null];
        return (
          <li key={a.seq} className="flex items-center gap-3 py-2.5 text-sm">
            {/* sales indexed before the sale field existed only have their text */}
            <span className="shrink-0">{(s?.nft ?? (a.text.includes("lock") ? "lock" : "life")) === "lock" ? <PixelLock size={18} /> : <PixelHeart size={20} />}</span>
            <span className="min-w-0 flex-1">
              <span className="block">{who}</span>
            </span>
            <span className="shrink-0 text-right">
              {price && <b className="num block">{price}</b>}
              <span className="label num">{ago < 1 ? "now" : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
