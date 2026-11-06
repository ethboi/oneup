import { fmtUsdc, type Listing } from "@oneup/sdk";

export type AskingPriceOrder = "cheap" | "expensive";

/** Order by the seller's actual ask only. A payout ceiling is not an expected value. */
export function compareAskingPrices(a: Pick<Listing, "price">, b: Pick<Listing, "price">, order: AskingPriceOrder = "cheap") {
  const left = BigInt(a.price), right = BigInt(b.price);
  const result = left < right ? -1 : left > right ? 1 : 0;
  return order === "cheap" ? result : -result;
}

/** New listings require a seller-entered price; editing preserves all six USDC decimal places. */
export function listingPriceInput(listing?: Pick<Listing, "price">): string {
  return listing ? fmtUsdc(BigInt(listing.price), 6).replaceAll(",", "").replace(/0+$/, "").replace(/\.$/, "") : "";
}

/** A listing's price for reading: dollars and cents, rounded up so it never reads below what the buyer pays. */
export function listingPriceLabel(listing: Pick<Listing, "price">): string {
  const cent = 10_000n;
  return `$${fmtUsdc(((BigInt(listing.price) + cent - 1n) / cent) * cent)}`;
}

/** A replacement listing can have the same NFT and ask but a different seller or transfer approval. */
export function listingsPollKey(listings: Listing[]): string {
  return JSON.stringify(listings.map(l => [l.nft_contract, l.token_id, l.seller, l.approval_id, l.price, l.listed_at]));
}
