"use client";

import { useOneUp } from "@/lib/oneup";
import { Icon } from "./Icon";
import type { WalletStatus } from "@/lib/near-wallet";

/** What a transaction in progress is waiting on, once a wallet is involved (lib/near-wallet.ts). */
const WAITING_ON: Partial<Record<WalletStatus, string>> = {
  // some wallets also send the transaction before they return, so this can last past your approval
  signing: "Waiting for your wallet",
  confirming: "Waiting for NEAR to confirm",
};

export function Toasts() {
  const { toasts, wallet } = useOneUp();
  const waitingOn = WAITING_ON[wallet.status];
  return (
    <div className="fixed bottom-[140px] right-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2 lg:bottom-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="panel px-4 py-3 text-sm font-bold shadow-[var(--panel-shadow)]"
          style={{ borderColor: t.kind === "error" ? "var(--short)" : t.kind === "ok" ? "var(--long)" : "var(--line)" }}
        >
          <span className="mr-2 inline-flex align-[-3px]" style={{ color: t.kind === "ok" ? "var(--long)" : t.kind === "error" ? "var(--short)" : "var(--muted)" }}>
            <Icon name={t.kind === "pending" ? "spinner" : t.kind === "ok" ? "check" : "x"} />
          </span>
          {t.text}
          {t.kind === "pending" && waitingOn && <span className="label mt-0.5 block font-normal">{waitingOn}</span>}
        </div>
      ))}
    </div>
  );
}
