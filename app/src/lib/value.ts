"use client";

// What Extra Lives and locks are worth, for suggested prices and the marketplace's "worth" column.

import { ONEUP, USDC, type LifeInfo, type LockInfo } from "@oneup/sdk";
import { useOneUp, usePoll } from "./oneup";

/** USDC an Extra Life can still pay: unclaimed, plus what's left to earn while it's live. */
export function lifeValue(l: LifeInfo): bigint {
  if (l.expired || l.full_heal) return BigInt(l.claimable);
  return BigInt(l.owed) - BigInt(l.paid) + BigInt(l.claimable);
}

/** A lock's $1UP if left today (after the penalty), at `px` USDC per $1UP. */
export function lockValue(l: LockInfo, px: bigint): bigint {
  if (l.withdrawn) return 0n;
  return ((BigInt(l.amount) - BigInt(l.exit_penalty)) * px) / ONEUP;
}

/** USDC (1e6) per whole $1UP, from the swap. */
export function useOneupPrice(): bigint {
  const { o } = useOneUp();
  const out = usePoll(() => o.swapQuote(100n * USDC), [], 15_000);
  return out && BigInt(out) > 0n ? (100n * USDC * ONEUP) / BigInt(out) : 0n;
}
