// Where an order is, by the house contract's rules (contracts/house/src/trading.rs: fill, cancel_order, expire):
//
//   waiting  ──(a price published after it, inside the fill window)──> filled (gone)
//   resting  ──(a limit open: the price reaches the limit)───────────> filled (gone)
//   waiting/resting ──(window over)──> expiring ──(keeper calls expire)──> gone: an open's margin returns to the
//                                                                          free balance; a close leaves the position open

import type { Order } from "./client.ts";

export type OrderStage =
  /** A market open or a close, waiting for a price published after it. It expires at `expiresAt` without one. */
  | { stage: "waiting"; expiresAt: number }
  /** A limit open, resting until the price reaches it, or until `expiresAt`. Cancellable after the fill window. */
  | { stage: "resting"; expiresAt: number }
  /** Past its window: it can no longer fill, and the keeper (or anyone) expires it next. */
  | { stage: "expiring"; expiredAt: number };

/** Where `order` is at `nowS` (seconds), given the house's `fill_window_s` and `limit_expiry_s` (get_params). */
export function orderStage(
  order: Pick<Order, "kind" | "placed_at">,
  nowS: number,
  params: { fill_window_s: number; limit_expiry_s: number },
): OrderStage {
  const limit = "Open" in order.kind && !!order.kind.Open.limit;
  const expiresAt = order.placed_at + (limit ? params.limit_expiry_s : params.fill_window_s);
  // the contract expires an order once now > placed_at + window
  if (nowS > expiresAt) return { stage: "expiring", expiredAt: expiresAt };
  return limit ? { stage: "resting", expiresAt } : { stage: "waiting", expiresAt };
}
