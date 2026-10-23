import { test } from "node:test";
import assert from "node:assert/strict";
import type { Order } from "@oneup/sdk";
import { reservedMargin } from "../src/lib/account.ts";

const pending = { kind: { Open: { margin: "50" } } } as Order;
const close = { kind: { Close: { position_id: 1, reason: "Close" } } } as Order;
test("equity is conserved through order placement, fill, close request and cancellation", () => {
  assert.equal(1000n + reservedMargin([], []), 1000n);
  assert.equal(950n + reservedMargin([], [pending]), 1000n);
  assert.equal(950n + reservedMargin([{ margin: "50" }], []), 1000n);
  assert.equal(950n + reservedMargin([{ margin: "50" }], [close]), 1000n);
  assert.equal(1000n + reservedMargin([], []), 1000n);
  assert.equal(reservedMargin([{ margin: "70" }], [pending, pending, close]), 170n);
});
