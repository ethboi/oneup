"use client";

import { USDC, accountSender } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";

/** Testnet account preparation: with a wallet, the wallet signs; as a guest, the guest key in this browser signs
 *  (lib/guest.ts). The server never signs or mints for a wallet account; for a guest it only created the account. */
export function WalletActions() {
  const { d, o, me, tx, wallet, run, main, guest, leaveGuest } = useOneUp();
  const tokens = [d.contracts.usdc, d.contracts.oneup];
  const registered = usePoll(() => Promise.all(tokens.map(token => o.view<unknown | null>(token, "storage_balance_of", { account_id: me }))), [me, ...tokens], 5000);
  const ready = registered?.every(Boolean);
  const send = guest && main ? accountSender(main) : wallet.send;
  const prepare = async () => {
    for (const token of tokens) {
      if (await o.view(token, "storage_balance_of", { account_id: me })) continue;
      const bounds = await o.view<{ min: string }>(token, "storage_balance_bounds");
      const amount = BigInt(bounds.min);
      if (amount < 0n || amount > 10n ** 23n) throw new Error("Unexpected token storage cost; review the token contract");
      await send({ contractId: token, methodName: "storage_deposit", args: { account_id: me, registration_only: true }, deposit: amount });
    }
  };
  return <div className="flex flex-col gap-3 rounded-lg border border-[var(--line)] p-3">
    <p className="text-sm font-bold">{guest ? "Guest account (NEAR testnet)" : "Your NEAR testnet wallet"}</p>
    <p className="label break-all">{me}</p>
    <p className="label">
      {guest
        ? "A throwaway testnet account made in this browser. Its key stays in this browser's storage and signs for you, so there is nothing to approve. Test money only: clearing this site's data forgets the account."
        : "Approve transactions in your connected NEAR wallet. Test NEAR pays gas and token storage."}
    </p>
    <button className="btn btn-ghost" disabled={wallet.busy || !registered || ready} onClick={() => run("Register test tokens", prepare)}>
      {!registered ? "Checking token registration…" : ready ? "Test tokens registered" : "Register test tokens"}
    </button>
    {d.testUsdcFaucet && <button className="btn btn-ghost" disabled={wallet.busy} onClick={() => run("Get 1,000 test USDC", () => tx.faucet(1000n * USDC))}>Get 1,000 test USDC</button>}
    {guest ? (
      <>
        <button className="btn btn-ghost" disabled={wallet.busy} onClick={() => void wallet.connect()}>Connect a wallet instead</button>
        <button className="btn btn-ghost" onClick={leaveGuest}>Leave the guest account</button>
      </>
    ) : (
      <button className="btn btn-ghost" disabled={wallet.busy} onClick={() => void wallet.disconnect()}>Disconnect wallet</button>
    )}
    {wallet.error && <p role="alert" className="text-sm text-[var(--short)]">{wallet.error}</p>}
    <a className="label underline" href="/wallet-setup">Wallet and testnet help</a>
  </div>;
}
