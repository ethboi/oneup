import { test } from "node:test";
import assert from "node:assert/strict";
import type { Order } from "@oneup/sdk";
import { processOrders } from "../src/orders.ts";

test("keeper processes later opens and closes behind 200 resting limits without skipping removed pages", async () => {
  const resting = Array.from({ length: 200 }, (_, id) => ({ id, owner: "trader", market_id: "NEAR", placed_at: 100, kind: { Open: { side: "Long", margin: "1000000", leverage: 1, cut_ppm: "100000", triggers: { take_profit: null, stop_loss: null }, limit: "1" } } }));
  const active = [
    { ...resting[0], id: 200, kind: { ...resting[0].kind, Open: { ...resting[0].kind.Open, limit: null } } },
    { id: 201, owner: "trader", market_id: "NEAR", placed_at: 100, kind: { Close: { position_id: 999, reason: "Close" } } },
    ...Array.from({ length: 205 }, (_, n) => ({ ...resting[0], id: n + 202, placed_at: 1 })),
  ];
  let orders = [...resting, ...active] as Order[];
  let reads = 0;
  const filled: number[] = [], expired: number[] = [];
  const remove = (id: number) => { orders = orders.filter(o => o.id !== id); };
  await processOrders(async (from, limit) => { reads++; return orders.slice(from, from + limit); }, {
    fill: async id => { assert.equal(reads, 3); filled.push(id); remove(id); return true; },
    expire: async id => { assert.equal(reads, 3); expired.push(id); remove(id); },
  }, new Map([["NEAR", "feed"]]), new Map([["feed", { price: 100n, time: 101 }]]), () => 110, 30, 100, () => {});
  assert.deepEqual(filled, [200, 201]);
  assert.equal(expired.length, 205);
  assert.equal(orders.length, 200);
});
