/**
 * Who's using the app, which decides what renders (lib/oneup.tsx):
 *   "local"     the local demo: dev accounts sign, no wallet
 *   "watching"  testnet, no wallet: the app view-only, and any action asks for a wallet
 *   "connected" testnet with a wallet account
 */
export type Access = "local" | "watching" | "connected";

export function accessOf(network: string, account: string): Access {
  if (network !== "testnet") return "local";
  return account ? "connected" : "watching";
}
