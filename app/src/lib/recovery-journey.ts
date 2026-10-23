import type { LifeInfo } from "@oneup/sdk";
import { lifeEconomics } from "./life-economics";

export const lifeHref = (tokenId: string) => `/extra-lives#life=${encodeURIComponent(tokenId)}`;

/** A Life's ID is opaque, including ':' and percent characters. Other page anchors stay unrelated. */
export function lifeFromHash(hash: string): string | null {
  if (!hash.startsWith("#life=")) return null;
  try {
    return decodeURIComponent(hash.slice(6)) || null;
  } catch {
    return null;
  }
}

/** Claimable funds remain visible even after the NFT stops earning. Every NFT appears exactly once. */
export function groupLives(lives: LifeInfo[]) {
  const claimable: LifeInfo[] = [];
  const earning: LifeInfo[] = [];
  const finished: LifeInfo[] = [];
  for (const life of lives) {
    const economics = lifeEconomics(life);
    if (economics.claimable > 0n) claimable.push(life);
    else if (economics.canReceiveMore) earning.push(life);
    else finished.push(life);
  }
  claimable.sort((a, b) => BigInt(a.claimable) === BigInt(b.claimable) ? b.epoch - a.epoch : BigInt(a.claimable) > BigInt(b.claimable) ? -1 : 1);
  earning.sort((a, b) => b.epoch - a.epoch);
  finished.sort((a, b) => b.epoch - a.epoch);
  return { claimable, earning, finished };
}

/** Match the contract/SDK limit and advertise only the funds this transaction will request. */
export function lifeClaimBatch(lives: LifeInfo[]) {
  const ready = groupLives(lives).claimable;
  const selected = ready.slice(0, 30);
  return {
    tokenIds: selected.map(life => life.token_id),
    amount: selected.reduce((sum, life) => sum + BigInt(life.claimable), 0n),
    remainingCount: ready.length - selected.length,
  };
}

/** Prioritize funds that can be claimed now, then an existing NFT, then unsettled losses. */
export function recoveryStep(lives: LifeInfo[] | undefined, pendingLoss: string | undefined) {
  if (!lives || pendingLoss === undefined) return { phase: "loading" as const, claimable: 0n, count: 0, tokenId: null };
  const groups = groupLives(lives);
  const claimable = lives.reduce((sum, life) => sum + BigInt(life.claimable), 0n);
  if (groups.claimable.length) return { phase: "claim" as const, claimable, count: groups.claimable.length, tokenId: groups.claimable[0].token_id };
  if (groups.earning.length) return { phase: "earning" as const, claimable, count: groups.earning.length, tokenId: groups.earning[0].token_id };
  if (BigInt(pendingLoss) > 0n) return { phase: "pending" as const, claimable, count: 0, tokenId: null };
  if (groups.finished.length) return { phase: "finished" as const, claimable, count: groups.finished.length, tokenId: groups.finished[0].token_id };
  return { phase: "empty" as const, claimable, count: 0, tokenId: null };
}
