// A failed transaction, sent to Sentry (lib/sentry.ts) so intermittent failures can be diagnosed: which action, at
// which step (lib/wallet-send.ts), with which wallet, and the error itself. Testnet only. Nothing secret is in it:
// account ids and transaction hashes are public on chain.

import * as Sentry from "@sentry/nextjs";
import { sendFailure } from "./wallet-send";

/** Fire and forget: a report that can't be sent must never get in the way. */
export function reportFailure(label: string, e: unknown, account: string) {
  try {
    const send = sendFailure(e);
    const wallet = e && typeof e === "object" && "wallet" in e ? String((e as { wallet: unknown }).wallet ?? "") : "";
    Sentry.withScope((scope) => {
      scope.setTag("action", label);
      if (send?.step) scope.setTag("step", send.step);
      if (wallet) scope.setTag("wallet", wallet);
      if (account) scope.setUser({ id: account });
      scope.setContext("transaction", { method: send?.method, hash: send?.hash });
      Sentry.captureException(e instanceof Error ? e : new Error(String(e).slice(0, 600)));
    });
  } catch {}
}
