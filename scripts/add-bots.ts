// Tops a running local chain up to `BOTS` trading bots without a reset: creates the missing botN accounts with
// their own keys, funds them like the deploy does (50,000 test USDC and 10,000 $1UP), and adds them to
// localnet.json. Restart the bots (pnpm stop && pnpm demo) to start them.
//
//   pnpm bots:add

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPair, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { ONEUP, USDC, type Deployment } from "@oneup/sdk";
import { BOTS } from "./deploy.ts";

const file = resolve(import.meta.dirname, "../localnet.json");
const d: Deployment = JSON.parse(readFileSync(file, "utf8"));
if (d.network !== "localnet") throw new Error("Localnet only");
const provider = new JsonRpcProvider({ url: d.rpcUrl });
const root = new Account(d.owner.id, provider, d.owner.key as KeyPairString);
const call = (contractId: string, methodName: string, args: Record<string, unknown>, deposit = 0n) =>
  root.callFunction({ contractId, methodName, args, gas: teraToGas("300"), deposit });

for (let i = d.bots.length + 1; i <= BOTS; i++) {
  const id = `bot${i}.${d.owner.id}`;
  const key = KeyPair.fromRandom("ed25519");
  await root.createSubAccount({ accountOrPrefix: `bot${i}`, publicKey: key.getPublicKey(), nearToTransfer: nearToYocto("20") });
  // ve and the house pay storage themselves; USDC and $1UP need the account registered
  await call(d.contracts.usdc, "storage_deposit", { account_id: id }, nearToYocto("0.01")).catch(() => {});
  await call(d.contracts.oneup, "storage_deposit", { account_id: id }, nearToYocto("0.01")).catch(() => {});
  await call(d.contracts.usdc, "mint", { receiver_id: id, amount: (50_000n * USDC).toString() });
  await call(d.contracts.oneup, "ft_transfer", { receiver_id: id, amount: (10_000n * ONEUP).toString() }, 1n);
  d.bots.push({ id, key: key.toString() });
  writeFileSync(file, JSON.stringify(d, null, 2));
  console.log(`added ${id}`);
}
console.log(`${d.bots.length} bots`);
