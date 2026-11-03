// Adds trading bots to a testnet deployment made by `pnpm deploy:testnet --execute`: creates botN accounts under
// the operator with their own keys and a little test NEAR for gas, registers them with test USDC and $1UP, and
// writes them into the private operator.json, so `ONEUP_CONFIG=<operator.json> pnpm bots` trades with them.
// The bots fetch their own test USDC from the faucet as they go. Re-running tops up to the count, never past it.
//
//   ONEUP_CONFIG=/abs/.testnet/<operator>/operator.json ONEUP_TESTNET_BOTS=6 pnpm testnet:bots --execute

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Account, JsonRpcProvider, KeyPair, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { ONEUP, USDC, type Deployment } from "@oneup/sdk";

const file = process.env.ONEUP_CONFIG;
if (!file || !isAbsolute(file)) throw Error("Set ONEUP_CONFIG to the absolute path of the testnet operator.json.");
if ((statSync(file).mode & 0o077) !== 0) throw Error("operator.json must be owner-only (chmod 600).");
const d: Deployment = JSON.parse(readFileSync(file, "utf8"));
if (d.network !== "testnet") throw Error("This adds bots to a testnet deployment only.");

const count = Number(process.env.ONEUP_TESTNET_BOTS ?? "6");
const nearEach = process.env.ONEUP_TESTNET_BOT_NEAR ?? "2.5";
if (!Number.isInteger(count) || count < 1 || count > 12) throw Error("ONEUP_TESTNET_BOTS must be 1 to 12.");
const missing = Array.from({ length: count }, (_, i) => i + 1).filter((i) => !d.bots.some((b) => b.id === `bot${i}.${d.owner.id}`));
const need = missing.length * Number(nearEach);
console.log(`${d.bots.length} bots now; adding ${missing.length} (${missing.map((i) => `bot${i}`).join(", ") || "none"}), ${nearEach} test NEAR each: ${need} test NEAR.`);
if (!process.argv.includes("--execute")) {
  console.log("Plan only. Run again with --execute to create them.");
  process.exit(0);
}

const provider = new JsonRpcProvider({ url: d.rpcUrl });
if ((await provider.getNetworkId()) !== "testnet") throw Error("RPC network is not testnet.");
const root = new Account(d.owner.id, provider, d.owner.key as KeyPairString);
const call = (contractId: string, methodName: string, args: Record<string, unknown>, deposit = 0n) =>
  root.callFunction({ contractId, methodName, args, gas: teraToGas("100"), deposit, waitUntil: "FINAL" });

for (const i of missing) {
  const id = `bot${i}.${d.owner.id}`;
  const key = KeyPair.fromRandom("ed25519");
  await root.createSubAccount({ accountOrPrefix: `bot${i}`, publicKey: key.getPublicKey(), nearToTransfer: nearToYocto(nearEach as `${number}`) });
  // saved straight away, so a later failure never loses a funded account's key
  d.bots.push({ id, key: key.toString() });
  writeFileSync(file, `${JSON.stringify(d, null, 2)}\n`, { mode: 0o600 });
  await call(d.contracts.usdc, "storage_deposit", { account_id: id }, nearToYocto("0.01")).catch(() => {});
  await call(d.contracts.oneup, "storage_deposit", { account_id: id }, nearToYocto("0.01")).catch(() => {});
  // $1UP for the bots that lock some; skipped if the operator holds none
  await call(d.contracts.oneup, "ft_transfer", { receiver_id: id, amount: (10_000n * ONEUP).toString() }, 1n).catch(() => console.log(`  ${id}: no $1UP sent`));
  console.log(`added ${id}`);
}
console.log(`${d.bots.length} bots. Start them with ONEUP_CONFIG=${file} pnpm bots (they take test USDC from the faucet, ${(10_000n * USDC) / USDC} at a time).`);
