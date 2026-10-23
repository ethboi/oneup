"use client";

// Nominal payout caps and spot exit estimates. These are not NFT market valuations.

import { ONEUP, USDC, type LifeInfo, type LockInfo } from "@oneup/sdk";
import { useOneUp, usePoll } from "./oneup";
import { lifeEconomics } from "./life-economics";

/** Nominal maximum, including claimable funds; future allocations are conditional. */
export function lifeValue(l: LifeInfo): bigint {
  const { claimable, additionalCap } = lifeEconomics(l);
  return claimable + additionalCap;
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
