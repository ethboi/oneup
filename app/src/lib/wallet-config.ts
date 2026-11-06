import type { EventMap, NearConnectorOptions, NearWalletBase } from "@hot-labs/near-connect";

/** Keep the picker and every wallet request on the configured test network. */
export function walletOptions(rpcUrls: string[]): NearConnectorOptions {
  return {
    network: "testnet",
    providers: { testnet: rpcUrls },
    features: { testnet: true, signInWithoutAddKey: true, signAndSendTransaction: true },
    excludedWallets: ["mynearwallet", "ethereum-wallets"],
    autoConnect: false,
  };
}

/** Recheck the selected wallet: injected wallets and stored selections can bypass picker filters. */
export function assertTestnetWallet(wallet: Pick<NearWalletBase, "manifest">): void {
  const { id, features } = wallet.manifest;
  if (id === "mynearwallet")
    throw new Error("MyNearWallet is being retired. Choose another NEAR testnet wallet.");
  if (id === "ethereum-wallets") throw new Error("This profile supports native NEAR wallets. Ethereum wallet accounts are not integrated.");
  if (features.testnet !== true || features.signInWithoutAddKey !== true || features.signAndSendTransaction !== true)
    throw new Error("Choose a wallet that supports NEAR testnet, account-only connection, and transaction signing.");
}

/** The sign-in result identifies the chosen account; remembered account lists do not. */
export function signedInAccount(event: Pick<EventMap["wallet:signIn"], "success" | "accounts">): string {
  if (!event.success || event.accounts.length !== 1 || !event.accounts[0].accountId)
    throw new Error("Choose exactly one NEAR testnet account in your wallet and connect again.");
  return event.accounts[0].accountId;
}
