/**
 * Who's using the app, which decides what renders (lib/oneup.tsx):
 *   "local"     the local demo: dev accounts sign, no wallet
 *   "welcome"   testnet, no wallet, hasn't chosen to look around: the connect screen
 *   "watching"  testnet, no wallet, looking around: the app view-only, and any action asks for a wallet
 *   "connected" testnet with a wallet account
 */
export type Access = "local" | "welcome" | "watching" | "connected";

export function accessOf(network: string, account: string, watching: boolean): Access {
  if (network !== "testnet") return "local";
  return account ? "connected" : watching ? "watching" : "welcome";
}
