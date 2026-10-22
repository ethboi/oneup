"use client";

// The marketplace: Extra Lives and $1UP locks for sale, priced in USDC. Each listing says in plain words what
// the buyer gets and how far under (or over) its value it's priced, best deals first. A Sell panel beside it
// lists what you could sell and what you have up, and recent sales show what things went for against their value.

import { useState } from "react";
import { USDC, fmtUsdc, type LifeInfo, type Listing, type LockInfo } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lifeValue, lockValue, useOneupPrice } from "@/lib/value";
import { fmtOneup } from "./Header";
import { PixelHeart, PixelLock } from "./Pixel";
import { Sell, useListings } from "./Sell";
import { useActivity, type ActivityItem } from "./Activity";
import { Explainer, PanelHead } from "./ui";
import { Icon } from "./Icon";

/** A life shares the pots of the epoch it's minted in and the 13 after (`life_expiry_epochs`). */
const LIFE_POTS = 14;

type Item =
  | { kind: "life"; l: Listing; info: LifeInfo; value: bigint }
  | { kind: "lock"; l: Listing; info: LockInfo; value: bigint };

type Filter = "all" | "life" | "lock";
type Sort = "deal" | "cheap" | "value";

/** Prices in cents under $100, whole dollars above. */
const usd = (x: bigint) => `$${fmtUsdc(x, x < 100n * USDC ? 2 : 0)}`;

/** How far under value (positive) or over it (negative) a price is, in %; null when it has no value. */
const discount = (price: bigint, value: bigint) => (value > 0n ? Math.round((1 - Number(price) / Number(value)) * 100) : null);

export function Market() {
  const { o, d, me } = useOneUp();
  const listings = useListings();
  const px = useOneupPrice();
  const wallet = BigInt(usePoll(() => o.usdcBalance(me), [me]) ?? "0");
  const epoch = usePoll(() => o.epoch(), [], 10_000);
  const sales = useActivity(100).filter((a) => a.kind === "sold");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("deal");

  // every listing's NFT, read once a poll: expired lives earn nothing more, so they aren't shown
  const key = listings.map((l) => `${l.nft_contract}:${l.token_id}:${l.price}`).join();
  const items = usePoll(
    async () => {
      const got = await Promise.all(
        listings.map(async (l): Promise<Item | null> => {
          if (l.nft_contract === d.contracts.life) {
            const info = await o.lifeInfo(l.token_id).catch(() => null);
            return info && !info.expired ? { kind: "life", l, info, value: lifeValue(info) } : null;
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
    .sort((a, b) => {
      const pa = BigInt(a.l.price);
      const pb = BigInt(b.l.price);
      if (sort === "cheap") return pa < pb ? -1 : pa > pb ? 1 : 0;
      if (sort === "value") return a.value > b.value ? -1 : a.value < b.value ? 1 : 0;
      return (discount(pb, b.value) ?? -999) - (discount(pa, a.value) ?? -999);
    });
  const lives = all.filter((x) => x.kind === "life").length;
  const locks = all.length - lives;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-5">
        <Explainer title="Market" line={<>Buy and sell Extra Lives and $1UP locks for USDC. You have <b className="num text-[var(--text)]">{usd(wallet)}</b> in your wallet.</>}>
          Buy someone&apos;s Extra Life and its USDC payouts are yours. Buy a lock and you get its $1UP when it ends, and its share
          of buybacks until then. You pay from your wallet&apos;s USDC and the NFT moves to you in the same step; if it was
          sold elsewhere first, your USDC comes straight back. Sellers pay 2% of the price, which goes into the house pool
          as profit (and so back to Extra Lives and buybacks).
        </Explainer>

        <div className="panel">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] p-3">
            <div className="chip-track" role="group" aria-label="Show">
              {(
                [
                  ["all", `All ${all.length}`],
                  ["life", `Extra Lives ${lives}`],
                  ["lock", `Locks ${locks}`],
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
                <option value="deal">Best deal</option>
                <option value="cheap">Cheapest</option>
                <option value="value">Most value</option>
              </select>
            </label>
          </div>
          {items === undefined ? (
            <p className="label p-4">Loading…</p>
          ) : shown.length === 0 ? (
            <EmptyMarket filter={filter} />
          ) : (
            <div className="divide-y divide-[var(--line)]">
              {shown.map((x) => (
                <Row key={`${x.l.nft_contract}:${x.l.token_id}`} x={x} wallet={wallet} epoch={epoch?.id} totalPower={totalPower ? BigInt(totalPower) : 0n} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div id="sell" className="panel scroll-mt-4">
          <PanelHead title="Sell" />
          <YourItems px={px} listings={listings} />
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
          <span className="label">Lost a trade? Your Extra Life and $1UP lock can be listed here.</span>
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
function YourItems({ px, listings }: { px: bigint; listings: Listing[] }) {
  const { o, d, me } = useOneUp();
  const lives = (usePoll(() => o.lives(me), [me]) ?? []).filter((l) => lifeValue(l) > 0n && !l.expired);
  const locks = (usePoll(() => o.locks(me), [me]) ?? []).filter((l) => !l.withdrawn);
  // the first three, so Recent sales stays in view; the rest on request
  const [all, setAll] = useState(false);
  const total = lives.length + locks.length;
  const shownLives = all ? lives : lives.slice(0, 3);
  const shownLocks = all ? locks : locks.slice(0, Math.max(0, 3 - shownLives.length));
  if (total === 0) {
    return <p className="label px-4 pb-4">Nothing to sell yet. Extra Lives and $1UP locks arrive when you lose a trade.</p>;
  }
  return (
    <div className="divide-y divide-[var(--line)]">
      <p className="label px-4 pb-3">
        Suggested prices are 70% of what a life can still pay and 80% of a lock&apos;s value if left today. You get the price less a 2% fee
        that goes to the house pool.
      </p>
      {shownLives.map((l) => (
        <div key={l.token_id} className="flex flex-col gap-2 p-3">
          <span className="flex min-w-0 items-center gap-3">
            <PixelHeart size={24} />
            <span className="min-w-0">
              <b className="block">{l.backer ? "Backer Life" : `Extra Life from round ${l.epoch}`}</b>
              <span className="label num">{usd(lifeValue(l))} still to pay</span>
            </span>
          </span>
          <Sell nft={d.contracts.life} tokenId={l.token_id} suggested={(lifeValue(l) * 7n) / 10n} listings={listings} compact />
        </div>
      ))}
      {shownLocks.map((l) => (
        <div key={l.token_id} className="flex flex-col gap-2 p-3">
          <span className="flex min-w-0 items-center gap-3">
            <PixelLock size={22} />
            <span className="min-w-0">
              <b className="block num">{fmtOneup(l.amount)} $1UP lock</b>
              <span className="label num">{px > 0n ? `${usd(lockValue(l, px))} if left today` : `unlocks in round ${l.end}`}</span>
            </span>
          </span>
          <Sell nft={d.contracts.ve} tokenId={l.token_id} suggested={px > 0n ? (lockValue(l, px) * 8n) / 10n : USDC} listings={listings} compact />
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

function Row({ x, wallet, epoch, totalPower }: { x: Item; wallet: bigint; epoch?: number; totalPower: bigint }) {
  const { me, tx, run } = useOneUp();
  const price = BigInt(x.l.price);
  const off = discount(price, x.value);
  const mine = x.l.seller === me;
  const short = wallet < price;

  let title: string;
  let detail: string;
  if (x.kind === "life") {
    const i = x.info;
    title = i.backer ? "Backer Life" : "Extra Life";
    const left = epoch === undefined || i.backer ? null : Math.max(0, i.epoch + LIFE_POTS - epoch);
    const earning = i.backer ? "earns until paid in full" : i.full_heal ? "paid in full" : left === null ? "…" : `earning for ${left} more round${left === 1 ? "" : "s"}`;
    detail = `Pays up to ${usd(x.value)} more · ${earning}`;
  } else {
    const i = x.info;
    title = `${fmtOneup(i.amount)} $1UP lock`;
    const left = epoch === undefined ? null : Math.max(0, i.end - epoch);
    const share = totalPower > 0n ? (Number(BigInt(i.power)) / Number(totalPower)) * 100 : null;
    const cut = share === null ? "" : ` · earns about ${share < 0.1 ? share.toFixed(2) : share.toFixed(1)}% of each buyback`;
    detail = left === 0 ? "Unlocked: its $1UP can be claimed now" : `Back in ${left ?? "…"} round${left === 1 ? "" : "s"}${cut}`;
  }

  return (
    // phones: price and button on their own line under the details
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 sm:flex-nowrap sm:px-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--panel-2)]">
        {x.kind === "life" ? <PixelHeart size={28} fill={x.info.full_heal ? 1 : lifeProgress(x.info)} /> : <PixelLock size={24} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <b className="truncate">{title}</b>
          {off !== null && off > 0 && <span className="deal num">{off}% off</span>}
          {off !== null && off < 0 && <span className="label num">{-off}% over value</span>}
        </div>
        <div className="label">{detail}</div>
        <div className="label num">
          Worth {usd(x.value)}
          {x.kind === "lock" ? " if left today" : ""}
        </div>
      </div>
      <div className="flex w-full shrink-0 items-center justify-between gap-2 pl-14 sm:w-auto sm:flex-col sm:items-end sm:gap-1 sm:pl-0">
        <span className="display num text-lg">{usd(price)}</span>
        {mine ? (
          <button className="btn btn-ghost px-3 py-1" onClick={() => run("Take down listing", () => tx.delist(x.l.nft_contract, x.l.token_id))}>
            Take down
          </button>
        ) : (
          <button
            className="btn btn-accent px-3 py-1"
            disabled={short}
            title={short ? `You need ${usd(price - wallet)} more USDC. Get test USDC from the Demo menu.` : undefined}
            onClick={() => run(`Buy for ${usd(price)}`, () => tx.buy(x.l.nft_contract, x.l.token_id, price))}
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

/** Recent sales, each against what it was worth when it sold (when the app saw it live). */
function Sales({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <p className="label px-4 pb-4">No sales yet.</p>;
  const now = Date.now();
  return (
    <ul className="divide-y divide-[var(--line)] px-4 pb-1">
      {items.map((a) => {
        const s = a.sale;
        const off = s?.value ? discount(BigInt(s.price), BigInt(s.value)) : null;
        const ago = Math.max(0, Math.round((now - a.t) / 60_000));
        return (
          <li key={a.seq} className="flex items-center gap-3 py-2.5 text-sm">
            {/* sales indexed before the sale field existed only have their text */}
            <span className="shrink-0">{(s?.nft ?? (a.text.includes("lock") ? "lock" : "life")) === "lock" ? <PixelLock size={18} /> : <PixelHeart size={20} />}</span>
            <span className="min-w-0 flex-1">
              <span className="block">{a.text}</span>
              {off !== null && (
                <span className="label num" style={{ color: off > 0 ? "var(--long)" : undefined }}>
                  {off > 0 ? `${off}% under value` : off < 0 ? `${-off}% over value` : "at value"}
                </span>
              )}
            </span>
            <span className="label num shrink-0">{ago < 1 ? "now" : ago < 60 ? `${ago}m` : `${Math.round(ago / 60)}h`}</span>
          </li>
        );
      })}
    </ul>
  );
}
