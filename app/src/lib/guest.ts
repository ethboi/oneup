// A guest on testnet: a key made in this browser, kept in its local storage, for a throwaway account OneUp creates
// (app/api/guest). The app then signs as that account with the key, the way the local demo signs with its test
// accounts. Test money only; clearing the browser's storage forgets the key and the account with it.

import { Account, KeyPair, type KeyPairString } from "near-api-js";
import { USDC, type OneUp } from "@oneup/sdk";

export interface Guest {
  accountId: string;
  /** The private key, "ed25519:...". It never leaves this browser. */
  key: string;
  /** The house this guest was made for: a redeploy starts fresh. */
  house: string;
  createdAt: number;
}

const STORE = "oneup.testnet.guest";

export function loadGuest(house: string): Guest | null {
  try {
    const g = JSON.parse(localStorage.getItem(STORE) ?? "null") as Guest | null;
    return g && g.house === house && typeof g.accountId === "string" && typeof g.key === "string" ? g : null;
  } catch {
    return null;
  }
}

export function saveGuest(g: Guest | null) {
  try {
    if (g) localStorage.setItem(STORE, JSON.stringify(g));
    else localStorage.removeItem(STORE);
  } catch {
    // private window: the guest lasts as long as the tab
  }
}

/** Whether this deployment offers guest accounts. */
export async function guestsAvailable(): Promise<boolean> {
  try {
    const r = await fetch("/api/guest", { cache: "no-store" });
    return r.ok && ((await r.json()) as { available?: boolean }).available === true;
  } catch {
    return false;
  }
}

/** Makes a key here, asks OneUp for an account with it, then readies the account with its own key: registers it
 *  for $1UP (USDC's faucet registers it for USDC) and takes 1,000 test USDC. */
export async function createGuest(o: OneUp, onStep?: (s: string) => void): Promise<Guest> {
  const { house, usdc, oneup } = o.d.contracts;
  const kp = KeyPair.fromRandom("ed25519");
  onStep?.("Creating your guest account…");
  const r = await fetch("/api/guest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: kp.getPublicKey().toString() }) });
  const j = (await r.json().catch(() => ({}))) as { accountId?: string; error?: string };
  if (!r.ok || !j.accountId) throw new Error(j.error ?? "The guest account couldn't be created.");
  const guest: Guest = { accountId: j.accountId, key: kp.toString(), house, createdAt: Date.now() };
  saveGuest(guest);
  const account = new Account(guest.accountId, o.provider, guest.key as KeyPairString);
  onStep?.("Registering for $1UP…");
  const bounds = await o.view<{ min: string }>(oneup, "storage_balance_bounds");
  await account.callFunction({ contractId: oneup, methodName: "storage_deposit", args: { account_id: guest.accountId, registration_only: true }, deposit: BigInt(bounds.min) });
  onStep?.("Getting 1,000 test USDC…");
  await account.callFunction({ contractId: usdc, methodName: "faucet", args: { amount: String(1000n * USDC) } });
  return guest;
}
