import { test } from "node:test";
import assert from "node:assert/strict";
import { accessOf } from "../src/lib/access.ts";

test("access: the local demo never asks for a wallet; testnet shows the connect screen until you connect or choose to look around", () => {
  assert.equal(accessOf("localnet", "", false), "local");
  assert.equal(accessOf("localnet", "demo.test.near", true), "local");
  assert.equal(accessOf("testnet", "", false), "welcome");
  assert.equal(accessOf("testnet", "", true), "watching");
  assert.equal(accessOf("testnet", "alice.testnet", false), "connected");
  assert.equal(accessOf("testnet", "alice.testnet", true), "connected");
});
