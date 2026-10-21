// What the relayer (/api/relay) pays for: one no-deposit trade call on the house from a local account, at
// most 100 Tgas, and a few per sender at a time.

import { teraToGas } from "near-api-js";

export const RELAY_METHODS = ["place_open", "place_close", "set_triggers"];
export const MAX_RELAY_GAS = teraToGas("100");
const RATE = { max: 10, windowMs: 10_000 };

export interface Delegate {
  senderId: string;
  receiverId: string;
  actions: { functionCall?: { methodName: string; gas: bigint | number | string; deposit: bigint | number | string } }[];
}

/** null if the relayer may pay for `da`, else why not. */
export function validateDelegate(da: Delegate, house: string): string | null {
  if (!/\.test\.near$/.test(da.senderId)) return "Local accounts only";
  if (da.receiverId !== house || da.actions.length !== 1) return "The relayer only pays for trades on the house";
  const fc = da.actions[0].functionCall;
  if (!fc || !RELAY_METHODS.includes(fc.methodName) || BigInt(fc.deposit) !== 0n) return "The relayer only pays for trades on the house";
  if (BigInt(fc.gas) > MAX_RELAY_GAS) return "Too much gas: at most 100 Tgas";
  return null;
}

const recent = new Map<string, number[]>();

/** Counts a relay for `sender`; false once it has had RATE.max in the last RATE.windowMs. */
export function underLimit(sender: string, now = Date.now()): boolean {
  const ts = (recent.get(sender) ?? []).filter((t) => now - t < RATE.windowMs);
  const ok = ts.length < RATE.max;
  if (ok) ts.push(now);
  recent.set(sender, ts);
  if (recent.size > 1000) for (const [k, v] of recent) if (!v.some((t) => now - t < RATE.windowMs)) recent.delete(k);
  return ok;
}
