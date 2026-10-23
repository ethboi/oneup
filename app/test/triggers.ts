import { test } from "node:test";
import assert from "node:assert/strict";
import { editablePrice, triggerValues } from "../src/lib/triggers.ts";

test("trigger edits preserve precise prices and reject nonempty invalid protection", () => {
  assert.deepEqual(triggerValues("", "3.550000000"), { takeProfit: null, stopLoss: 355000000n });
  assert.equal(editablePrice("1"), "0.00000001");
  assert.deepEqual(triggerValues("", editablePrice("1")), { takeProfit: null, stopLoss: 1n });
  for (const invalid of ["Infinity", "1e999", "NaN", "3.550000001", "0", "-1"]) {
    assert.equal(triggerValues("", invalid), undefined);
    assert.equal(triggerValues(invalid, ""), undefined);
  }
  assert.deepEqual(triggerValues("", ""), { takeProfit: null, stopLoss: null });
});
