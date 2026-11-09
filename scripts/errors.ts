// The failed transactions browsers reported (app/src/app/api/report), newest first.
//   pnpm errors [count]
// Reads the store's URL and token from KV_REST_API_URL / KV_REST_API_TOKEN, or from the file in ONEUP_UPSTASH_ENV
// (default .testnet/upstash.env in the main checkout). Prints neither.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = process.env.ONEUP_UPSTASH_ENV ?? resolve(import.meta.dirname, "../.testnet/upstash.env");
if ((!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) && existsSync(file))
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
if (!url || !token) {
  console.error(`No store: set KV_REST_API_URL and KV_REST_API_TOKEN, or ONEUP_UPSTASH_ENV (looked in ${file})`);
  process.exit(1);
}
const count = Number(process.argv[2] ?? 20);
const call = async (...cmd: string[]) => {
  const r = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error(`store answered ${r.status}`);
  return ((await r.json()) as { result: unknown }).result;
};

const keys = (await call("KEYS", "oneup:*:errors")) as string[];
if (keys.length === 0) console.log("No failures reported.");
for (const key of keys) {
  const rows = ((await call("LRANGE", key, "0", String(count - 1))) as string[]).map((x) => JSON.parse(x) as Record<string, string | number>);
  console.log(`${key}: ${rows.length} shown`);
  for (const r of rows) {
    const when = new Date(Number(r.t)).toISOString().replace("T", " ").slice(0, 19);
    console.log(`\n${when}  ${r.account ?? "?"}  wallet ${r.wallet || "?"}  step ${r.step ?? "?"}${r.method ? ` (${r.method})` : ""}`);
    console.log(`  ${r.label}`);
    console.log(`  ${r.error}`);
    if (r.hash) console.log(`  tx ${r.hash}`);
    if (r.ua) console.log(`  ${r.ua}`);
  }
}
