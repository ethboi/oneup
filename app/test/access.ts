import { test } from "node:test";
import assert from "node:assert/strict";
import { accessOf } from "../src/lib/access.ts";

test("access: the local demo never asks for a wallet; testnet is view-only until a wallet connects", () => {
  assert.equal(accessOf("localnet", ""), "local");
  assert.equal(accessOf("localnet", "demo.test.near"), "local");
  assert.equal(accessOf("testnet", ""), "watching");
  assert.equal(accessOf("testnet", "alice.testnet"), "connected");
});
