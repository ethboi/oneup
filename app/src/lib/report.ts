// A failed transaction, reported to OneUp's own server (/api/report) so intermittent failures can be diagnosed:
// which action, at which step (lib/wallet-send.ts), with which wallet and browser, and the error itself. Testnet
// only. Nothing secret is in it: account ids and transaction hashes are public on chain.

import { sendFailure } from "./wallet-send";

export interface Report {
  label: string;
  error: string;
  step?: string;
  method?: string;
  hash?: string;
  wallet?: string;
  account?: string;
  ua?: string;
  path?: string;
}

/** Fire and forget: a report that can't be sent must never get in the way. */
export function reportFailure(label: string, e: unknown, account: string) {
  try {
    const send = sendFailure(e);
    const report: Report = {
      label,
      error: String(e instanceof Error ? e.message : e).slice(0, 600),
      step: send?.step,
      method: send?.method,
      hash: send?.hash,
      wallet: e && typeof e === "object" && "wallet" in e ? String((e as { wallet: unknown }).wallet ?? "") : undefined,
      account,
      ua: navigator.userAgent.slice(0, 200),
      path: location.pathname,
    };
    void fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report), keepalive: true }).catch(() => {});
  } catch {}
}
