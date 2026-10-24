import type { LifeInfo } from "@oneup/sdk";

/** A snapshot of rights held by the current owner, never a price or expected return. */
export function describeLife(life: LifeInfo, currentRound: number, expiryRounds: number) {
  const total = BigInt(life.owed);
  const allocated = BigInt(life.paid);
  const claimable = BigInt(life.claimable);
  const remaining = life.expired || life.full_heal || allocated >= total ? 0n : total - allocated;
  const withdrawn = allocated > claimable ? allocated - claimable : 0n;
  const lastRound = life.backer ? null : life.epoch + expiryRounds;
  const roundsLeft = life.expired || remaining === 0n ? 0 : lastRound === null ? null : Math.max(0, lastRound - currentRound + 1);
  const state = life.expired ? "expired" : remaining === 0n ? "fully allocated" : roundsLeft === 0 ? "awaiting settlement" : "earning";
  return {
    token_id: life.token_id,
    owner_id: life.owner_id,
    backer: life.backer,
    originating_round: life.epoch,
    observed_round: currentRound,
    last_earning_round: lastRound,
    remaining_earning_rounds: roundsLeft,
    state,
    // Retain the original numeric fields for existing clients. owed_usd is a lifetime cap, not a debt.
    owed_usd: Number(total) / 1e6,
    paid_usd: Number(allocated) / 1e6,
    claimable_usd: Number(claimable) / 1e6,
    remaining_payout_limit_usd: Number(remaining) / 1e6,
    withdrawn_usd: Number(withdrawn) / 1e6,
    // Exact six-decimal USDC base units, serialized as strings for accounting clients.
    usdc_units: {
      maximum_total_payout: total.toString(),
      allocated_lifetime: allocated.toString(),
      withdrawn_lifetime: withdrawn.toString(),
      available_to_claim: claimable.toString(),
      remaining_conditional_limit: remaining.toString(),
    },
    interpretation: "Unclaimed USDC transfers with ownership. Remaining limit is conditional and can pay zero. Lifetime totals include earlier owners; expiry preserves allocated USDC. A final settlement may still be pending after the earning window.",
  };
}
