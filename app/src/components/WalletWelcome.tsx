"use client";

export function WalletWelcome({ connect, busy, error }: { connect: () => Promise<void>; busy: boolean; error: string | null }) {
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 p-6">
    <p className="label">OneUp · NEAR testnet · test money only</p>
    <h1 className="page-title">Connect your NEAR wallet</h1>
    <p>Trade with test funds, follow an Extra Life and try transferring its payout rights to another account.</p>
    <div className="panel space-y-3 p-5">
      <p>Choose a compatible testnet wallet through NEAR Connect. Meteor is the recommended starting point. You approve transactions in your wallet; OneUp does not receive your wallet’s private key.</p>
      <button className="btn btn-accent w-full" disabled={busy} onClick={() => void connect()}>{busy ? "Waiting for wallet…" : "Connect NEAR testnet wallet"}</button>
      {error && <p role="alert" className="text-sm text-[var(--short)]">{error}</p>}
      <p className="label">Use a browser supported by your chosen wallet and allow its connection window. Use test NEAR for gas. Reconnect after a page reload. Rabby and Phantom are not supported by this integration.</p>
    </div>
    <a className="underline" href="/wallet-setup">Testnet setup and supported features</a>
  </main>;
}
