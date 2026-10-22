"use client";

// List an Extra Life or a lock on the marketplace, re-price it or take it down. Shared by the Lives, Locks and
// Market tabs.

import { useState } from "react";
import { USDC, fmtUsdc, type Listing } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { Icon } from "./Icon";

export function useListings() {
  const { o } = useOneUp();
  return usePoll(() => o.listings(), [], 5000) ?? [];
}

/** `compact`: no top margin, for use inside a row. */
export function Sell({ nft, tokenId, suggested, listings, compact }: { nft: string; tokenId: string; suggested: bigint; listings: Listing[]; compact?: boolean }) {
  const mt = compact ? "" : "mt-3";
  const { tx, run } = useOneUp();
  const listing = listings.find((l) => l.nft_contract === nft && l.token_id === tokenId);
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(() => (Number(suggested) / Number(USDC)).toFixed(2));

  if (listing && !open) {
    return (
      // wraps rather than overflows in narrow columns (a lock's row)
      <div className={`${mt} flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-dashed border-[var(--line)] px-2.5 py-1.5 text-sm`}>
        <span className="num whitespace-nowrap">For sale at ${fmtUsdc(BigInt(listing.price))}</span>
        <span className="flex gap-1">
          <button className="btn btn-ghost whitespace-nowrap px-2 py-0.5 text-xs" onClick={() => setOpen(true)}>
            Re-price
          </button>
          <button className="btn btn-ghost whitespace-nowrap px-2 py-0.5 text-xs" onClick={() => run("Take down listing", () => tx.delist(nft, tokenId))}>
            Take down
          </button>
        </span>
      </div>
    );
  }
  if (!open) {
    return (
      // compact (in a row): a smaller button, so the life or lock it sells stays the focus
      <button className={`btn btn-ghost ${mt} w-full ${compact ? "py-1.5 text-sm" : ""}`} onClick={() => setOpen(true)}>
        <Icon name="tag" />
        Sell
      </button>
    );
  }
  // cents count: a small life can be worth under a dollar
  const raw = BigInt(Math.floor((Number(price) || 0) * Number(USDC)));
  return (
    <div className={`${mt} flex items-center gap-2`}>
      <span className="field flex-1">
        <input className="input num" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" aria-label="Price in USDC" />
        <span className="field-unit">USDC</span>
      </span>
      <button
        className="btn btn-accent shrink-0"
        disabled={raw === 0n}
        onClick={() => run(`List for $${price}`, () => tx.list(nft, tokenId, raw)).then((ok) => ok && setOpen(false))}
      >
        {listing ? "Update" : "List"}
      </button>
      <button className="btn btn-ghost shrink-0 px-2.5" onClick={() => setOpen(false)} aria-label="Cancel">
        <Icon name="x" />
      </button>
    </div>
  );
}
