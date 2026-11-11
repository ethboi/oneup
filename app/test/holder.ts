import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyPair, KeyPairSigner } from "near-api-js";
import { HOLDER_RECIPIENT, HOLDER_WINDOW_MS, holderMessage, parseHolderMessage, toBase64 } from "../src/lib/nep413.ts";
import { signedMessageProblem, sinceHeld } from "../src/lib/server/holder.ts";
import type { LifeItem } from "../src/lib/server/activity.ts";

const id = "12:alice.testnet";

/** Signs the way NEP-413 wallets do, with near-api-js's own signer, so the check is against another implementation. */
async function signed(message: string, recipient = HOLDER_RECIPIENT) {
  const kp = KeyPair.fromRandom("ed25519");
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const r = await new KeyPairSigner(kp).signNep413Message("alice.testnet", { message, recipient, nonce });
  return { tokenId: id, accountId: "alice.testnet", publicKey: r.publicKey.toString(), signature: toBase64(r.signature), nonce: toBase64(nonce), message };
}

test("a holder message signed by a NEP-413 signer passes; another Life, an old message or another site's does not", async () => {
  const now = Date.now();
  assert.equal(await signedMessageProblem(await signed(holderMessage(id, new Date(now))), now), null);
  assert.match((await signedMessageProblem(await signed(holderMessage("13:alice.testnet", new Date(now))), now))!, /doesn't name this Life/);
  assert.match((await signedMessageProblem(await signed(holderMessage(id, new Date(now - HOLDER_WINDOW_MS - 1000))), now))!, /expired/);
  assert.match((await signedMessageProblem(await signed(holderMessage(id, new Date(now)), "evil.example"), now))!, /doesn't match/);
  // the signature of one message doesn't carry over to another
  const a = await signed(holderMessage(id, new Date(now)));
  const b = await signed(holderMessage(id, new Date(now + 1000)));
  assert.match((await signedMessageProblem({ ...a, signature: b.signature }, now))!, /doesn't match/);
  assert.deepEqual(parseHolderMessage("anything else"), null);
});

const at = (t: number, e: Omit<LifeItem, "seq" | "t">): LifeItem => ({ ...e, t, seq: t }) as LifeItem;

test("since held: counts the holder's own claims after the Life came to them, and how it came", () => {
  const history = [
    at(6, { kind: "claimed", owner: "bob.testnet", amount: "2000000", lives: 1 }),
    at(5, { kind: "claimed", owner: "bob.testnet", amount: "9000000", lives: 3 }),
    at(4, { kind: "sold", from: "alice.testnet", to: "bob.testnet", price: "5000000" }),
    at(3, { kind: "claimed", owner: "alice.testnet", amount: "1000000", lives: 1 }),
    at(1, { kind: "minted", owner: "alice.testnet" }),
  ];
  assert.deepEqual(sinceHeld(history, "bob.testnet"), { how: "bought", t: 4, from: "alice.testnet", price: "5000000", claimed: "2000000", shared: [{ amount: "9000000", lives: 3 }] });
  assert.deepEqual(sinceHeld(history.slice(3), "alice.testnet"), { how: "minted", t: 1, claimed: "1000000", shared: [] });
  assert.equal(sinceHeld([at(2, { kind: "transferred", from: "bob.testnet", to: "carol.testnet" })], "carol.testnet").how, "received");
  assert.equal(sinceHeld([], "dave.testnet").how, "unknown");
});
