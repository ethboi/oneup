import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTestnetConfig } from "../app-config.ts";

// The keyless testnet profile: a file's path in ONEUP_PUBLIC_CONFIG (a local run), or the JSON itself in
// ONEUP_PUBLIC_CONFIG_JSON (a host such as Vercel, where there is no file to read).
export const hasPublicProfile = () => !!(process.env.ONEUP_PUBLIC_CONFIG || process.env.ONEUP_PUBLIC_CONFIG_JSON);
export function publicTestnetConfig() {
  const inline = process.env.ONEUP_PUBLIC_CONFIG_JSON;
  if (inline) return parseTestnetConfig(JSON.parse(inline));
  const path = process.env.ONEUP_PUBLIC_CONFIG;
  if (!path) throw new Error("No public testnet profile configured");
  return parseTestnetConfig(JSON.parse(readFileSync(resolve(/*turbopackIgnore: true*/ path), "utf8")));
}
