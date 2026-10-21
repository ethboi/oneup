import { test } from "node:test";
import assert from "node:assert/strict";
import { actions, teraToGas } from "near-api-js";
import { underLimit, validateDelegate, type Delegate } from "../src/lib/server/relay.ts";

const HOUSE = "house.test.near";
const call = (method: string, gas = teraToGas("100"), deposit = 0n) => actions.functionCall(method, {}, gas, deposit) as Delegate["actions"][number];
const da = (over: Partial<Delegate> = {}): Delegate => ({ senderId: "demo.test.near", receiverId: HOUSE, actions: [call("place_open")], ...over });

test("relay accepts the trade methods", () => {
  for (const m of ["place_open", "place_close", "set_triggers"]) assert.equal(validateDelegate(da({ actions: [call(m)] }), HOUSE), null);
});

test("relay rejects anything else", () => {
  assert.ok(validateDelegate(da({ receiverId: "usdc.test.near" }), HOUSE));
  assert.ok(validateDelegate(da({ actions: [call("place_open"), call("place_close")] }), HOUSE));
  assert.ok(validateDelegate(da({ actions: [] }), HOUSE));
  assert.ok(validateDelegate(da({ actions: [actions.transfer(1n) as Delegate["actions"][number]] }), HOUSE));
  assert.ok(validateDelegate(da({ actions: [call("place_open", teraToGas("100"), 1n)] }), HOUSE));
  assert.ok(validateDelegate(da({ actions: [call("withdraw")] }), HOUSE));
  assert.ok(validateDelegate(da({ actions: [call("place_open", teraToGas("101"))] }), HOUSE));
  assert.ok(validateDelegate(da({ senderId: "alice.near" }), HOUSE));
});

test("relay rate-limits each sender", () => {
  const now = 1_000_000;
  for (let i = 0; i < 10; i++) assert.ok(underLimit("rl.test.near", now + i));
  assert.equal(underLimit("rl.test.near", now + 10), false);
  assert.ok(underLimit("other.test.near", now + 10));
  assert.ok(underLimit("rl.test.near", now + 10_001));
});
