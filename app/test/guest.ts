import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyPair } from "near-api-js";
import { IN_TOTAL, PER_VISITOR, guestAccountId, guestLimit, validGuestKey } from "../src/lib/server/guest.ts";
import { onceCaughtUp, until } from "../src/lib/guest.ts";

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

test("guest setup waits for what it needs to show up, and gives up quietly", async () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => void waits.push(ms);
  // the new key shows on the third look; a failed look counts as "not yet"
  let looks = 0;
  assert.equal(await until(async () => { if (++looks === 2) throw new Error("fetch failed"); return looks >= 3; }, 20, 400, sleep), true);
  assert.deepEqual(waits, [400, 400]);
  // never shows: says so after the last look, without waiting once more
  waits.length = 0;
  assert.equal(await until(async () => false, 3, 400, sleep), false);
  assert.deepEqual(waits, [400, 400]);
});

test("a send refused because the RPC hadn't caught up is sent again; any other failure is not", async () => {
  const sleep = async () => {};
  // the account was made a block ago and this RPC doesn't have its key yet
  let sends = 0;
  const sent = await onceCaughtUp(async () => {
    if (++sends < 3) throw new Error("Access key ed25519:B2UiWV8B does not exist at block height 277281003");
    return "ok";
  }, 4, 700, sleep);
  assert.equal(sent, "ok");
  assert.equal(sends, 3);
  // the key's nonce from before the last transaction
  sends = 0;
  assert.equal(await onceCaughtUp(async () => { if (++sends < 2) throw new Error("InvalidNonce: tx nonce 5 must be larger than ak nonce 5"); return 1; }, 4, 700, sleep), 1);
  // a contract's own refusal is passed on at once
  sends = 0;
  await assert.rejects(onceCaughtUp(async () => { sends++; throw new Error("Smart contract panicked: faucet limit"); }, 4, 700, sleep), /faucet limit/);
  assert.equal(sends, 1);
  // and it doesn't try for ever
  sends = 0;
  await assert.rejects(onceCaughtUp(async () => { sends++; throw new Error("does not exist"); }, 4, 700, sleep), /does not exist/);
  assert.equal(sends, 4);
});
