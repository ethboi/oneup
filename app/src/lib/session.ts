// One-tap trading. A session key on this device is a NEAR function-call access key that may only call the
// house's place_open, place_close and set_triggers. It can't attach a deposit, so it can't deposit,
// withdraw or move tokens: trades only. With "gas paid by OneUp" its trades go as meta transactions
// (NEP-366) to /api/relay and the relayer pays the gas: the key's 0.25 NEAR gas budget only applies to
// trades it sends itself (not gasless), since a signed delegate action never spends the key's allowance.
// The key lives in this browser's storage, per account; turning it off deletes it from the account.

import {
  Account,
  KeyPair,
  actions,
  base64Encode,
  encodeSignedDelegate,
  getTransactionLastResult,
  nearToYocto,
  teraToGas,
  type JsonRpcProvider,
  type KeyPairString,
} from "near-api-js";
import type { Send } from "@oneup/sdk";

export const SESSION_METHODS = ["place_open", "place_close", "set_triggers"];
export const SESSION_ALLOWANCE = nearToYocto("0.25");

export interface Session {
  secret: KeyPairString;
  publicKey: string;
  gasless: boolean;
}

const key = (account: string) => `oneup.session.${account}`;

export function loadSession(account: string): Session | null {
  try {
    return JSON.parse(localStorage.getItem(key(account)) ?? "null");
  } catch {
    return null;
  }
}

export function saveSession(account: string, s: Session | null) {
  try {
    if (s) localStorage.setItem(key(account), JSON.stringify(s));
    else localStorage.removeItem(key(account));
  } catch {}
  window.dispatchEvent(new Event("oneup-session"));
}

/** Adds a trade-only key to `main`'s account (one approval with a real wallet). */
export async function startSession(main: Account, house: string, gasless: boolean): Promise<Session> {
  const kp = KeyPair.fromRandom("ed25519");
  await main.addFunctionCallAccessKey({
    publicKey: kp.getPublicKey(),
    contractId: house,
    methodNames: SESSION_METHODS,
    allowance: SESSION_ALLOWANCE,
  });
  const s = { secret: kp.toString() as KeyPairString, publicKey: kp.getPublicKey().toString(), gasless };
  saveSession(main.accountId, s);
  return s;
}

export async function endSession(main: Account, s: Session) {
  await main.deleteKey(s.publicKey).catch(() => {}); // already gone is fine
  saveSession(main.accountId, null);
}

/** The key's remaining gas budget (yoctoNEAR), or null if the key is gone. */
export async function sessionAllowance(provider: JsonRpcProvider, account: string, s: Session): Promise<bigint | null> {
  try {
    const k = (await provider.viewAccessKey({ accountId: account, publicKey: s.publicKey })) as unknown as {
      permission: { FunctionCall?: { allowance: string | null } } | string;
    };
    const fc = typeof k.permission === "object" ? k.permission.FunctionCall : undefined;
    return fc?.allowance ? BigInt(fc.allowance) : 0n;
  } catch {
    return null;
  }
}

/**
 * Sends trade calls with the session key (as a relayed meta transaction when gasless) and everything else
 * with `fallback`, the main key.
 */
export function sessionSender(account: string, provider: JsonRpcProvider, s: Session, house: string, fallback: Send): Send {
  const signer = new Account(account, provider, s.secret);
  return async <T>(c: Parameters<Send>[0]): Promise<T> => {
    if (c.contractId !== house || !SESSION_METHODS.includes(c.methodName) || (c.deposit ?? 0n) > 0n) return fallback<T>(c);
    const action = actions.functionCall(c.methodName, c.args, c.gas ?? teraToGas("100"), 0n);
    if (!s.gasless) {
      const out = await signer.signAndSendTransaction({ receiverId: house, actions: [action] });
      return getTransactionLastResult(out) as T;
    }
    const { signedDelegate } = await signer.createSignedMetaTransaction({ receiverId: house, actions: [action] });
    const r = await fetch("/api/relay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedDelegate: base64Encode(encodeSignedDelegate(signedDelegate)) }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Relay failed");
    return j.result as T;
  };
}
