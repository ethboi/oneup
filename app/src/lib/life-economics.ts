import type { LifeInfo } from "@oneup/sdk";

/** Current on-chain entitlements, never a sale-price or expected-return estimate. */
export function lifeEconomics(life: LifeInfo, currentEpoch?: number, expiryEpochs?: number) {
  const claimable = BigInt(life.claimable);
  const allocated = BigInt(life.paid);
  const unallocated = BigInt(life.owed) - allocated;
  const additionalCap = life.expired || life.full_heal || unallocated < 0n ? 0n : unallocated;
  const withdrawn = allocated > claimable ? allocated - claimable : 0n;
  // A loss Life earns in its minting round and `expiryEpochs` subsequent rounds. Backer Lives do not expire.
  const lastEarningEpoch = life.backer || expiryEpochs === undefined ? null : life.epoch + expiryEpochs;
  const remainingEarningRounds = life.expired || life.full_heal || additionalCap === 0n
    ? 0
    : life.backer || currentEpoch === undefined || lastEarningEpoch === null
      ? null
      : Math.max(0, lastEarningEpoch - currentEpoch + 1);
  const status: "earning" | "expired" | "fully-allocated" | "awaiting-settlement" = life.expired
    ? "expired"
    : life.full_heal || additionalCap === 0n
      ? "fully-allocated"
      : remainingEarningRounds === 0
        ? "awaiting-settlement"
        : "earning";
  return {
    claimable, additionalCap, allocated, withdrawn, lastEarningEpoch, remainingEarningRounds, status,
    // Zero remaining rounds can precede the last round's asynchronous settlement. Keep the contract cap
    // until the contract confirms expiry; do not present that balance as another earning round.
    canReceiveMore: additionalCap > 0n,
    hasRecoverableFunds: claimable > 0n || additionalCap > 0n,
  };
}

export function lifeEarningLabel(life: LifeInfo, currentEpoch?: number, expiryEpochs?: number): string {
  const economics = lifeEconomics(life, currentEpoch, expiryEpochs);
  if (economics.status === "expired") return "Expired · no further earning rounds";
  if (economics.status === "fully-allocated") return "Cap fully allocated · no further earnings";
  if (life.backer) return "No expiry · future payouts depend on house profit";
  if (economics.status === "awaiting-settlement") return "No earning rounds remain · final settlement may be pending";
  const rounds = economics.remainingEarningRounds;
  if (rounds === null) return "Loading earning window…";
  return `${rounds} earning round${rounds === 1 ? "" : "s"} remaining, including the current round · through round ${economics.lastEarningEpoch}`;
}
