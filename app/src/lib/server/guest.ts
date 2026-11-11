// Guest accounts on testnet, so a visitor can try OneUp without a wallet. The browser makes a key and sends only its
// public half; a sponsor account (ONEUP_GUEST_SPONSOR_ID, its key in ONEUP_GUEST_SPONSOR_KEY) creates a throwaway
// account `g<random>.<sponsor>` with that key and a little test NEAR, in one transaction. The guest's own key then
// registers for the tokens and takes test USDC from the faucet (lib/guest.ts). Testnet only; the sponsor holds test
// NEAR and nothing else, and guests are rate-limited per visitor and in total.

import { Account, KeyType, PublicKey, actions, nearToYocto, type KeyPairString } from "near-api-js";
import { FailoverProvider, rpcList } from "@oneup/sdk";
import { publicTestnetConfig } from "./public-config";

/** Test NEAR each guest gets. A trade attaches 300 Tgas, which NEAR reserves up front at a cautious gas price (about
 *  0.3 NEAR, mostly refunded), so a guest needs well over that available, plus its account and token storage. */
export const GUEST_NEAR = "1";
/** Per visitor, and in total, per hour: the sponsor's test NEAR is finite. */
export const PER_VISITOR = 3;
export const IN_TOTAL = 40;

export function sponsor(): { id: string; key: string } | null {
  const id = process.env.ONEUP_GUEST_SPONSOR_ID;
  const key = process.env.ONEUP_GUEST_SPONSOR_KEY;
  return id && key ? { id, key } : null;
}

/** Only an ed25519 public key, as "ed25519:<base58>". */
export function validGuestKey(publicKey: unknown): publicKey is string {
  if (typeof publicKey !== "string" || publicKey.length > 80) return false;
  try {
    return PublicKey.fromString(publicKey).keyType === KeyType.ED25519;
  } catch {
    return false;
  }
}

/** A new guest's account id: short, random, under the sponsor. */
export function guestAccountId(sponsorId: string, random: Uint8Array = crypto.getRandomValues(new Uint8Array(5))): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return `g${[...random].map((b) => alphabet[b % alphabet.length]).join("")}.${sponsorId}`;
}

/** Counts one request against the limits; returns why it's refused, or null. Uses the store when there is one
 *  (shared by every server instance), else this instance's memory. */
export async function guestLimit(visitor: string, now = Date.now()): Promise<string | null> {
  const hour = Math.floor(now / 3_600_000);
  const keys = [`guests:${hour}:${visitor}`, `guests:${hour}:all`];
  const counts = await incr(keys).catch(() => keys.map((k) => memory(k)));
  if (counts[0] > PER_VISITOR) return "You've made a few guest accounts this hour already. Use the one in this browser, or try again later.";
  if (counts[1] > IN_TOTAL) return "Guest accounts are busy right now. Try again in a little while, or connect a NEAR testnet wallet.";
  return null;
}

const local = new Map<string, number>();
function memory(key: string): number {
  const n = (local.get(key) ?? 0) + 1;
  local.set(key, n);
  if (local.size > 5000) local.clear();
  return n;
}

async function incr(keys: string[]): Promise<number[]> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("no store");
  const r = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(keys.flatMap((k) => [["INCR", `oneup:${k}`], ["EXPIRE", `oneup:${k}`, "7200"]])),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`store answered ${r.status}`);
  const out = (await r.json()) as { result: number }[];
  return [Number(out[0].result), Number(out[2].result)];
}

/** Creates the guest's account with its key and test NEAR. Retries once if another request used the sponsor's
 *  nonce at the same moment. */
export async function createGuestAccount(publicKey: string): Promise<string> {
  const s = sponsor();
  if (!s) throw new Error("not configured");
  const cfg = publicTestnetConfig();
  const account = new Account(s.id, new FailoverProvider(rpcList(cfg.rpcUrl)), s.key as KeyPairString);
  for (let attempt = 0; ; attempt++) {
    const id = guestAccountId(s.id);
    try {
      await account.signAndSendTransaction({
        receiverId: id,
        actions: [actions.createAccount(), actions.transfer(nearToYocto(GUEST_NEAR)), actions.addFullAccessKey(PublicKey.fromString(publicKey))],
      });
      return id;
    } catch (e) {
      if (attempt >= 1 || !/nonce|already exists/i.test(String(e))) throw e;
    }
  }
}
