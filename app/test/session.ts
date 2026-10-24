import { test } from "node:test";
import assert from "node:assert/strict";
import type { Account } from "near-api-js";
import { endSession, type Session } from "../src/lib/session.ts";

test("failed chain revocation is reported before local session state can be cleared", async () => {
  const main = { accountId: "alice", deleteKey: async () => { throw new Error("RPC down"); }, provider: { viewAccessKeyList: async () => { throw new Error("RPC down"); } } } as unknown as Account;
  await assert.rejects(endSession(main, { publicKey: "key" } as Session), /RPC down/);
});

test("confirmed absent session keys clear local state; present keys and failed queries do not", async () => {
  const removed: string[] = [];
  const events: string[] = [];
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { removeItem: (key: string) => removed.push(key) } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: (event: Event) => { events.push(event.type); return true; } } });
  const failure = new Error("DeleteKeyDoesNotExist");
  let keys: { public_key: string }[] = [];
  const main = { accountId: "alice", deleteKey: async () => { throw failure; }, provider: { viewAccessKeyList: async (args: unknown) => {
    assert.deepEqual(args, { accountId: "alice", finalityQuery: { finality: "final" } });
    return { keys };
  } } } as unknown as Account;
  try {
    await endSession(main, { publicKey: "key" } as Session);
    assert.deepEqual(removed, ["oneup.session.alice"]);
    assert.deepEqual(events, ["oneup-session"]);
    removed.length = 0;
    keys = [{ public_key: "key" }];
    await assert.rejects(endSession(main, { publicKey: "key" } as Session), /DeleteKeyDoesNotExist/);
    main.provider.viewAccessKeyList = async () => { throw new Error("RPC down"); };
    await assert.rejects(endSession(main, { publicKey: "key" } as Session), /DeleteKeyDoesNotExist/);
    assert.deepEqual(removed, []);
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("a removed session key falls back before signing and clears only that saved session", async () => {
  const { KeyPair } = await import("near-api-js");
  const { sessionSender } = await import("../src/lib/session.ts");
  const { teraToGas } = await import("near-api-js");
  const kp = KeyPair.fromRandom("ed25519");
  const session: Session = { secret: kp.toString() as Session["secret"], publicKey: kp.getPublicKey().toString(), gasless: true };
  let saved: Session | null = session;
  let cleared = 0, fallbacks = 0;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => saved ? JSON.stringify(saved) : null,
    removeItem: () => { saved = null; cleared++; },
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: () => true } });
  const provider = { viewAccessKeyList: async (args: unknown) => {
    assert.deepEqual(args, { accountId: "demo.test.near", finalityQuery: { finality: "final" } });
    return { keys: [] };
  } } as unknown as Account["provider"];
  const call = { contractId: "house.test.near", methodName: "place_open", args: {}, gas: teraToGas("100") };
  try {
    const send = sessionSender("demo.test.near", provider, session, "house.test.near", async <T>(c: unknown) => {
      assert.equal(c, call); fallbacks++; return 7 as T;
    });
    assert.equal(await send(call), 7);
    assert.equal(cleared, 1); assert.equal(fallbacks, 1);
    // A delayed response about the old key must not clear a newly created session.
    saved = { ...session, publicKey: "replacement" };
    await send(call);
    assert.equal(cleared, 1); assert.equal(fallbacks, 2);
    assert.equal(saved.publicKey, "replacement");
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage"); Reflect.deleteProperty(globalThis, "window");
  }
});

test("an RPC failure checking a session never clears it or retries via the main key", async () => {
  const { KeyPair } = await import("near-api-js");
  const { sessionSender } = await import("../src/lib/session.ts");
  const kp = KeyPair.fromRandom("ed25519");
  const session: Session = { secret: kp.toString() as Session["secret"], publicKey: kp.getPublicKey().toString(), gasless: false };
  const provider = { viewAccessKeyList: async () => { throw new Error("RPC unavailable"); } } as unknown as Account["provider"];
  let fallback = false;
  const send = sessionSender("demo.test.near", provider, session, "house.test.near", async <T>() => { fallback = true; return undefined as T; });
  await assert.rejects(send({ contractId: "house.test.near", methodName: "place_open", args: {} }), /RPC unavailable/);
  assert.equal(fallback, false);
});

test("a valid session submits once and never falls back after an uncertain submission", async () => {
  const { Account: NearAccount, KeyPair } = await import("near-api-js");
  const { sessionSender } = await import("../src/lib/session.ts");
  const kp = KeyPair.fromRandom("ed25519");
  const session: Session = { secret: kp.toString() as Session["secret"], publicKey: kp.getPublicKey().toString(), gasless: false };
  const provider = { viewAccessKeyList: async () => ({ keys: [{ public_key: session.publicKey }] }) } as unknown as Account["provider"];
  const original = NearAccount.prototype.signAndSendTransaction;
  let submissions = 0, fallbacks = 0;
  NearAccount.prototype.signAndSendTransaction = async () => { submissions++; throw new Error("Response lost after submission"); };
  try {
    const send = sessionSender("demo.test.near", provider, session, "house.test.near", async <T>() => { fallbacks++; return undefined as T; });
    await assert.rejects(send({ contractId: "house.test.near", methodName: "place_open", args: {} }), /Response lost after submission/);
    assert.equal(submissions, 1); assert.equal(fallbacks, 0);
  } finally { NearAccount.prototype.signAndSendTransaction = original; }
});

test("new sessions wait for finalized key creation before being stored", async () => {
  const { startSession } = await import("../src/lib/session.ts");
  let stored = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: () => { stored = true; } } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: () => true } });
  const main = { accountId: "demo.test.near", signAndSendTransaction: async (tx: { receiverId: string; waitUntil: string }) => {
    assert.equal(tx.receiverId, "demo.test.near"); assert.equal(tx.waitUntil, "FINAL"); assert.equal(stored, false);
  } } as unknown as Account;
  try { await startSession(main, "house.test.near", true); assert.equal(stored, true); }
  finally { Reflect.deleteProperty(globalThis, "localStorage"); Reflect.deleteProperty(globalThis, "window"); }
});
