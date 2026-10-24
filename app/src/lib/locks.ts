import type { LockInfo } from "@oneup/sdk";

export const lockOrigin = (lock: Pick<LockInfo, "merged" | "from_loss" | "created">) => lock.merged > 0
  ? `Merged from ${lock.merged} locks`
  : lock.from_loss ? `Reward for round ${lock.created}` : `Locked in round ${lock.created}`;

export function lockCountdown(end: number, epoch: number) {
  if (epoch >= end) return "Ready to unlock";
  if (end === epoch + 1) return "Unlocks next round";
  return `Unlocks in round ${end} · ${end - epoch} rounds remaining`;
}
