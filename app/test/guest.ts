import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyPair } from "near-api-js";
import { IN_TOTAL, PER_VISITOR, guestAccountId, guestLimit, validGuestKey } from "../src/lib/server/guest.ts";

test("guest keys: only an ed25519 public key is accepted", () => {
  assert.ok(validGuestKey(KeyPair.fromRandom("ed25519").getPublicKey().toString()));
  assert.equal(validGuestKey(KeyPair.fromRandom("ed25519").toString()), false); // a private key
  assert.equal(validGuestKey("ed25519:notbase58!!"), false);
  assert.equal(validGuestKey(42), false);
  assert.equal(validGuestKey("x".repeat(200)), false);
});

test("a guest's account is a short random name under the sponsor, valid as a NEAR account id", () => {
  const id = guestAccountId("guests.oneupmarkets.testnet", new Uint8Array([0, 1, 35, 36, 255]));
  assert.equal(id, "gab9ad.guests.oneupmarkets.testnet"); // 0→a, 1→b, 35→9, 36→a, 255→d (255 mod 36 = 3)
  for (let i = 0; i < 50; i++) assert.match(guestAccountId("guests.oneupmarkets.testnet"), /^g[a-z0-9]{5}\.guests\.oneupmarkets\.testnet$/);
});

test("guest limits: a few per visitor and a cap in total each hour (memory, when there is no store)", async () => {
  const prior = process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_URL;
  try {
    const hour = Date.UTC(2026, 10, 12, 3);
    for (let i = 0; i < PER_VISITOR; i++) assert.equal(await guestLimit("1.2.3.4", hour), null);
    assert.match((await guestLimit("1.2.3.4", hour))!, /this hour already/);
    // another visitor is still let in, until the total is reached
    assert.equal(await guestLimit("5.6.7.8", hour), null);
    let refused: string | null = null;
    for (let i = 0; i < IN_TOTAL && !refused; i++) refused = await guestLimit(`10.0.${i >> 8}.${i & 255}`, hour);
    assert.match(refused!, /busy right now/);
    // the next hour starts again
    assert.equal(await guestLimit("1.2.3.4", hour + 3_600_000), null);
  } finally {
    if (prior !== undefined) process.env.KV_REST_API_URL = prior;
  }
});
