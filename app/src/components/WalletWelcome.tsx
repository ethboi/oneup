"use client";

import { Logo } from "./Pixel";

export function WalletWelcome({ connect, busy, error, watch }: { connect: () => Promise<void>; busy: boolean; error: string | null; watch: () => void }) {
  return <main className="pixel-field mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 p-6 text-center">
    <Logo size={56} />
    <h1 className="page-title">Connect your NEAR wallet</h1>
    <p>Testnet only, with test money. You approve every transaction.</p>
    <div className="flex w-full flex-col gap-3">
      <button className="btn btn-accent w-full" disabled={busy} onClick={() => void connect()}>{busy ? "Waiting for wallet…" : "Connect NEAR testnet wallet"}</button>
      {error && <p role="alert" className="text-sm text-[var(--short)]">{error}</p>}
      <button className="btn btn-ghost w-full" onClick={watch}>Look around first</button>
    </div>
    <a className="label underline" href="/wallet-setup">Need a testnet wallet?</a>
  </main>;
}
