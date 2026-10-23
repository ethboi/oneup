import type { Order, Position } from "@oneup/sdk";

/** Pending opens hold real margin; pending closes already have their margin in a position. */
export function reservedMargin(positions: Pick<Position, "margin">[], orders: Pick<Order, "kind">[]) {
  return positions.reduce((sum, p) => sum + BigInt(p.margin), 0n)
    + orders.reduce((sum, order) => sum + ("Open" in order.kind ? BigInt(order.kind.Open.margin) : 0n), 0n);
}
