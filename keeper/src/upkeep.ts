import type { CloseStep, Market, Order, Position } from "@oneup/sdk";

/** Each byte a NEAR account stores locks up this much of its balance. */
const YOCTO_PER_BYTE = 10n ** 19n;
const NEAR = 10n ** 24n;
/** A contract with less spare than this may soon be unable to store what it next mints: a stuck round close, as on
 *  6 Nov. Low enough that a contract that barely stores anything, such as the oracle, is left alone. */
export const TOP_UP_BELOW = NEAR;
export const TOP_UP_BY = 5n * NEAR;
/** What the operator keeps back for itself. */
export const OPERATOR_KEEPS = 5n * NEAR;

export const spareNear = (a: { amount: bigint; storage_usage: number }) => a.amount - BigInt(a.storage_usage) * YOCTO_PER_BYTE;

/** Which accounts to send NEAR to, lowest first, as far as the operator can afford. */
export function topUpsDue(accounts: { id: string; spare: bigint }[], operatorSpare: bigint): { due: string[]; short: string[] } {
  const low = accounts.filter((a) => a.spare < TOP_UP_BELOW).sort((a, b) => (a.spare < b.spare ? -1 : a.spare > b.spare ? 1 : 0));
  const due: string[] = [];
  const short: string[] = [];
  let left = operatorSpare;
  for (const a of low) {
    if (left - TOP_UP_BY >= OPERATOR_KEEPS) {
      due.push(a.id);
      left -= TOP_UP_BY;
    } else short.push(a.id);
  }
  return { due, short };
}

/** The markets that need prices: the live ones, and a paused one while anything is still open on it, so its
 *  positions can still be closed and liquidated. Pausing only stops new trades. */
export function marketsToPrice<M extends Pick<Market, "id" | "live">>(markets: M[], positions: Pick<Position, "market_id">[], orders: Pick<Order, "market_id">[]): M[] {
  return markets.filter((m) => m.live || positions.some((p) => p.market_id === m.id) || orders.some((o) => o.market_id === m.id));
}

/** Whether close_epoch has more to do straight away; otherwise it's waiting on something and the next tick asks again.
 *  A retry that keeps failing mustn't take the whole tick: fills and liquidations come after it. */
export const closeCanContinue = (step: CloseStep) => !/^(waiting|retrying)/.test(step);
