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
