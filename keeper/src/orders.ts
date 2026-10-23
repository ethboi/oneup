import type { Order } from "@oneup/sdk";

/** Snapshot every page before fills/expiries mutate the contract's iterable map. */
export async function processOrders(
  listOrders: (from: number, limit: number) => Promise<Order[]>,
  keeper: { fill: (id: number) => Promise<boolean>; expire: (id: number) => Promise<unknown> },
  feeds: Map<string, string>,
  latest: Map<string, { price: bigint; time: number }>,
  nowS: () => number,
  FILL_WINDOW_S: number,
  LIMIT_EXPIRY_S: number,
  log: (message: string) => void,
) {
  const orders: Order[] = [];
  for (let from = 0; ; from += 200) {
    const page = await listOrders(from, 200);
    orders.push(...page);
    if (page.length < 200) break;
  }
  for (const o of orders) {
    const limit = "Open" in o.kind && o.kind.Open.limit ? BigInt(o.kind.Open.limit) : null;
    const label =
      "Open" in o.kind
        ? `${limit ? "limit " : ""}open ${o.kind.Open.side} ${o.market_id}`
        : `${o.kind.Close.reason === "Close" ? "close" : o.kind.Close.reason.toLowerCase()} #${o.kind.Close.position_id}`;
    if (nowS() > o.placed_at + (limit ? LIMIT_EXPIRY_S : FILL_WINDOW_S)) {
      await keeper.expire(o.id);
      log(`expired order ${o.id} (${label})`);
      continue;
    }
    const px = latest.get(feeds.get(o.market_id) ?? "");
    if (!px || px.time <= o.placed_at) continue; // wait for a price published after the order
    // a resting limit only fills once the price reaches it (the house checks again): no call, no gas, until then
    if (limit && "Open" in o.kind && (o.kind.Open.side === "Long" ? px.price > limit : px.price < limit)) continue;
    const ok = await keeper.fill(o.id);
    log(`${ok ? "filled" : "could not fill"} order ${o.id} (${label})`);
  }
}
