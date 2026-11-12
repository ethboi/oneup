import type { Order } from "@oneup/sdk";

/** How long (s) a filled or expired order is left alone. A read of the list taken straight after can still show it,
 *  and going at it again is a call the house refuses ("No such order"): gas for nothing, and the rest of the pass
 *  lost. A quick --tick reads that soon after about one fill in three. */
export const SETTLED_FOR_S = 10;

/** Snapshot every page before fills/expiries mutate the contract's iterable map. Returns how many orders are still
 *  waiting for a price published after them, so the keeper can push one now instead of on its next schedule.
 *  `settled`: the orders this keeper has filled or expired and when (s), kept by the caller from pass to pass. */
export async function processOrders(
  listOrders: (from: number, limit: number) => Promise<Order[]>,
  keeper: { fill: (id: number) => Promise<boolean>; expire: (id: number) => Promise<unknown> },
  feeds: Map<string, string>,
  latest: Map<string, { price: bigint; time: number }>,
  nowS: () => number,
  FILL_WINDOW_S: number,
  LIMIT_EXPIRY_S: number,
  log: (message: string) => void,
  settled: Map<number, number> = new Map(),
): Promise<number> {
  for (const [id, at] of settled) if (nowS() - at >= SETTLED_FOR_S) settled.delete(id);
  const orders: Order[] = [];
  let waiting = 0;
  for (let from = 0; ; from += 200) {
    const page = await listOrders(from, 200);
    orders.push(...page);
    if (page.length < 200) break;
  }
  for (const o of orders) {
    if (settled.has(o.id)) continue;
    const limit = "Open" in o.kind && o.kind.Open.limit ? BigInt(o.kind.Open.limit) : null;
    const label =
      "Open" in o.kind
        ? `${limit ? "limit " : ""}open ${o.kind.Open.side} ${o.market_id}`
        : `${o.kind.Close.reason === "Close" ? "close" : o.kind.Close.reason.toLowerCase()} #${o.kind.Close.position_id}`;
    if (nowS() > o.placed_at + (limit ? LIMIT_EXPIRY_S : FILL_WINDOW_S)) {
      await keeper.expire(o.id);
      settled.set(o.id, nowS());
      log(`expired order ${o.id} (${label})`);
      continue;
    }
    const px = latest.get(feeds.get(o.market_id) ?? "");
    if (!px || px.time <= o.placed_at) {
      waiting++; // wait for a price published after the order
      continue;
    }
    // a resting limit only fills once the price reaches it (the house checks again): no call, no gas, until then
    if (limit && "Open" in o.kind && (o.kind.Open.side === "Long" ? px.price > limit : px.price < limit)) continue;
    const ok = await keeper.fill(o.id);
    if (ok) settled.set(o.id, nowS());
    log(`${ok ? "filled" : "could not fill"} order ${o.id} (${label})`);
  }
  return waiting;
}
