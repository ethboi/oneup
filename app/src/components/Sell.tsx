"use client";

// List a Life NFT or a lock on the marketplace, re-price it or take it down. Shared by the Lives, Locks and
// Market tabs.

import { parseTokenAmount } from "@oneup/sdk";
import { useState } from "react";
import { type Listing } from "@oneup/sdk";
import { listingPriceInput } from "@/lib/market-pricing";
import { useOneUp, usePoll } from "@/lib/oneup";
import { Icon } from "./Icon";

export function useListings() {
  const { o } = useOneUp();
  return usePoll(() => o.listings(), [], 5000) ?? [];
}

/** `compact`: no top margin, for use inside a row. */
export function Sell({ nft, tokenId, listings, compact }: { nft: string; tokenId: string; listings: Listing[]; compact?: boolean }) {
  const mt = compact ? "" : "mt-3";
  const { tx, run } = useOneUp();
  const listing = listings.find((l) => l.nft_contract === nft && l.token_id === tokenId);
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const beginListing = () => {
    setPrice(listingPriceInput(listing));
    setOpen(true);
  };

  if (listing && !open) {
    return (
      // wraps rather than overflows in narrow columns (a lock's row)
      <div className={`${mt} flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-dashed border-[var(--line)] px-2.5 py-1.5 text-sm`}>
        <span className="num whitespace-nowrap">Listed for ${listingPriceInput(listing)}</span>
        <span className="flex flex-wrap gap-1">
          <button className="btn btn-ghost whitespace-nowrap px-2 py-0.5 text-xs" onClick={beginListing}>
            Update price
          </button>
          <button className="btn btn-ghost whitespace-nowrap px-2 py-0.5 text-xs" onClick={() => run("Remove listing", () => tx.delist(nft, tokenId))}>
            Remove listing
          </button>
        </span>
      </div>
    );
  }
  if (!open) {
    return (
      // compact (in a row): a smaller button, so the life or lock it sells stays the focus
      <button className={`btn btn-ghost ${mt} w-full ${compact ? "py-1.5 text-sm" : ""}`} onClick={beginListing}>
        <Icon name="tag" />
        List for sale
      </button>
    );
  }
  // The seller chooses the price; a payout cap is not a price recommendation.
  const raw = parseTokenAmount(price, 6);
  return (
    <div className={`${mt} flex flex-wrap items-center gap-2`}>
      <span className="field min-w-24 flex-1">
        <input className="input num" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Your asking price" aria-label="Price in USDC" />
        <span className="field-unit">USDC</span>
      </span>
      <button
        className="btn btn-accent shrink-0"
        disabled={raw === 0n}
        onClick={() => run(`List for sale at $${price}`, () => tx.list(nft, tokenId, raw)).then((ok) => ok && setOpen(false))}
      >
        {listing ? "Update price" : "List"}
      </button>
      <button className="btn btn-ghost shrink-0 px-2.5" onClick={() => setOpen(false)} aria-label="Cancel">
        <Icon name="x" />
      </button>
    </div>
  );
}
