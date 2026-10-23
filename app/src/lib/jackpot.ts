import type { ActivityItem } from "./server/activity";

/** Rollover events share the feed kind but have no winner and must not trigger a win celebration. */
export function latestJackpotWin(items: ActivityItem[]) {
  return items.filter((item): item is ActivityItem & { who: string; amount: string } =>
    item.kind === "jackpot" && !!item.who && item.amount !== undefined && BigInt(item.amount) > 0n,
  ).at(-1);
}
