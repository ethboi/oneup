import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTestnetConfig } from "../app-config.ts";

export const hasPublicProfile = () => !!process.env.ONEUP_PUBLIC_CONFIG;
export function publicTestnetConfig() {
  const path = process.env.ONEUP_PUBLIC_CONFIG;
  if (!path) throw new Error("No public testnet profile configured");
  return parseTestnetConfig(JSON.parse(readFileSync(resolve(/*turbopackIgnore: true*/ path), "utf8")));
}
