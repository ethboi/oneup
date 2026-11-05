import { atProfitCap, isLiquidatable, pnl, stopHit, targetHit, type Order, type Position } from "@oneup/sdk";

/** Whether a position needs the keeper at `price`: liquidation, the profit cap, or the trader's own trigger once its
 *  minimum hold is over. */
function positionHit(p: Position, price: bigint, nowS: number, minHoldS: number): boolean {
  const margin = BigInt(p.margin);
  const v = pnl(p.side, margin, p.leverage, BigInt(p.entry_price), price);
  if (isLiquidatable(v, margin) || atProfitCap(v, margin)) return true;
  if (p.close_order !== null || nowS < p.opened_at + minHoldS) return false;
  const { take_profit: tp, stop_loss: sl } = p.triggers;
  return (!!tp && targetHit(p.side, price, BigInt(tp))) || (!!sl && stopHit(p.side, price, BigInt(sl)));
}

/** Whether a resting limit order can fill at `price` (the house checks again). */
function limitReached(o: Order, price: bigint): boolean {
  if (!("Open" in o.kind) || !o.kind.Open.limit) return false;
  const limit = BigInt(o.kind.Open.limit);
  return o.kind.Open.side === "Long" ? price <= limit : price >= limit;
}

/**
 * Whether a fresh price crosses something the last pushed price didn't: a small move can still liquidate a 1000×
 * position, so it must not wait behind the "has it moved enough to pay gas" filter. Only a new crossing counts, so a
 * position already past its line (and being handled) doesn't force a push on every check.
 */
export function crossesThreshold(marketId: string, pushed: bigint | undefined, fresh: bigint, positions: Position[], orders: Order[], nowS: number, minHoldS: number): boolean {
  const crossed = (hit: (price: bigint) => boolean) => hit(fresh) && !(pushed !== undefined && hit(pushed));
  return (
    positions.some((p) => p.market_id === marketId && crossed((x) => positionHit(p, x, nowS, minHoldS))) ||
    orders.some((o) => o.market_id === marketId && crossed((x) => limitReached(o, x)))
  );
}
