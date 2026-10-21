"use client";

// List an Extra Life or a lock on the marketplace, or take it down. Shared by the Lives and Locks cards.

import { useState } from "react";
import { USDC, fmtUsdc, type Listing } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { Icon } from "./Icon";

export function useListings() {
  const { o } = useOneUp();
  return usePoll(() => o.listings(), [], 5000) ?? [];
}

export function Sell({ nft, tokenId, suggested, listings }: { nft: string; tokenId: string; suggested: bigint; listings: Listing[] }) {
  const { tx, run } = useOneUp();
  const listing = listings.find((l) => l.nft_contract === nft && l.token_id === tokenId);
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(() => (Number(suggested) / Number(USDC)).toFixed(0));

  if (listing) {
    return (
      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--line)] px-3 py-2 text-sm">
        <span className="num">For sale at ${fmtUsdc(BigInt(listing.price))}</span>
        <button className="btn btn-ghost px-3 py-1" onClick={() => run("Take down listing", () => tx.delist(nft, tokenId))}>
          Take down
        </button>
      </div>
    );
  }
  if (!open) {
    return (
      <button className="btn btn-ghost mt-3 w-full" onClick={() => setOpen(true)}>
        <Icon name="tag" />
        Sell
      </button>
    );
  }
  const raw = BigInt(Math.floor(Number(price) || 0)) * USDC;
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="field flex-1">
        <input className="input num" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" aria-label="Price in USDC" />
        <span className="field-unit">USDC</span>
      </span>
      <button
        className="btn btn-accent shrink-0"
        disabled={raw === 0n}
        onClick={() => run(`List for $${price}`, () => tx.list(nft, tokenId, raw)).then((ok) => ok && setOpen(false))}
      >
        List
      </button>
      <button className="btn btn-ghost shrink-0 px-2.5" onClick={() => setOpen(false)} aria-label="Cancel">
        <Icon name="x" />
      </button>
    </div>
  );
}
