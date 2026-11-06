import type { LockInfo } from "@oneup/sdk";

export const lockOrigin = (lock: Pick<LockInfo, "merged" | "from_loss" | "created">) => lock.merged > 0
  ? `Merged from ${lock.merged} locks`
  : lock.from_loss ? `Reward for round ${lock.created}` : `Locked in round ${lock.created}`;

/** Rewards can still land on a recent round: only older answers can be remembered. */
const SETTLED_AFTER = 4;
/** Reward checks in one poll, so a long history fills in a few at a time. */
const CHECKS_PER_POLL = 25;
/** Rounds a single claim covers. A lock with more waiting claims the rest with another. */
export const CLAIM_ROUNDS = 40;

/** Which finished rounds to ask about rewards next, given those already known not to change. */
export function roundsToCheck(oldestCreated: number, epoch: number, settled: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (let e = epoch - 1; e >= Math.max(0, oldestCreated) && out.length < CHECKS_PER_POLL; e--) if (!settled.has(e)) out.push(e);
  return out;
}

export const isSettledRound = (round: number, epoch: number) => round < epoch - SETTLED_AFTER;

export function lockCountdown(end: number, epoch: number) {
  if (epoch >= end) return "Ready to unlock";
  if (end === epoch + 1) return "Unlocks next round";
  return `Unlocks in round ${end} · ${end - epoch} rounds remaining`;
}
