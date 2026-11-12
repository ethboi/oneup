import { test } from "node:test";
import assert from "node:assert/strict";
import type { Order } from "@oneup/sdk";
import { SETTLED_FOR_S, processOrders } from "../src/orders.ts";

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

test("keeper leaves a just-filled or just-expired order alone when the next read of the list still shows it", async () => {
  const open = (id: number, placed_at: number) => ({ id, owner: "trader", market_id: "NEAR", placed_at, kind: { Open: { side: "Long", margin: "1000000", leverage: 1, cut_ppm: "100000", triggers: { take_profit: null, stop_loss: null }, limit: null } } });
  // the list as a node a block behind gives it: the fill and the expiry haven't reached it yet
  const stale = [open(1, 100), open(2, 50)] as Order[];
  const fills: number[] = [], expiries: number[] = [];
  const settled = new Map<number, number>();
  let now = 110;
  const pass = (orders: Order[]) =>
    processOrders(async (from, limit) => orders.slice(from, from + limit), {
      fill: async id => { fills.push(id); return true; },
      expire: async id => { expiries.push(id); },
    }, new Map([["NEAR", "feed"]]), new Map([["feed", { price: 100n, time: 101 }]]), () => now, 30, 100, () => {}, settled);
  await pass(stale);
  now += 2;
  await pass([...stale, open(3, 100)] as Order[]);
  assert.deepEqual(fills, [1, 3]);
  assert.deepEqual(expiries, [2]);
  // remembered only for as long as a read can be behind
  now += SETTLED_FOR_S;
  await pass([]);
  assert.equal(settled.size, 0);
});

test("keeper tries again at once when the house did not fill", async () => {
  const order = { id: 7, owner: "trader", market_id: "NEAR", placed_at: 100, kind: { Open: { side: "Long", margin: "1000000", leverage: 1, cut_ppm: "100000", triggers: { take_profit: null, stop_loss: null }, limit: null } } } as Order;
  const settled = new Map<number, number>();
  let calls = 0;
  const pass = () =>
    processOrders(async (from, limit) => [order].slice(from, from + limit), { fill: async () => ++calls > 1, expire: async () => {} }, new Map([["NEAR", "feed"]]), new Map([["feed", { price: 100n, time: 101 }]]), () => 110, 30, 100, () => {}, settled);
  await pass();
  await pass();
  assert.equal(calls, 2);
});
