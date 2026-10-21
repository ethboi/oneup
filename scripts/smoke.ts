// `pnpm smoke`: end-to-end check against a running localnet + keeper. The demo trader deposits, opens a 50x
// NEAR long, the keeper fills it, the price is steered down 2%, and the keeper liquidates it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, type KeyPairString } from "near-api-js";
import { OneUp, USDC, accountSender, fmtUsdc, type Deployment } from "@oneup/sdk";

const d: Deployment = JSON.parse(readFileSync(resolve(import.meta.dirname, "../localnet.json"), "utf8"));
const o = new OneUp(d);
const me = d.demo.id;
const tx = o.calls(accountSender(new Account(me, o.provider, d.demo.key as KeyPairString)));
const CONTROL = "http://127.0.0.1:8787";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => Promise<T | undefined | null | false>, timeoutS = 60): Promise<T> {
  for (let i = 0; i < timeoutS; i++) {
    const v = await f();
    if (v) return v;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const free = async () => BigInt(await o.balance(me));
console.log(`free balance ${fmtUsdc(await free())}`);
await tx.deposit(1_000n * USDC);
console.log(`deposited 1,000 → free ${fmtUsdc(await free())}`);

const before = (await o.positions(me)).map((p) => p.id);
await tx.placeOpen("NEAR-USD", "Long", 500n * USDC, 50);
console.log("placed 500 USDC 50x NEAR long; waiting for the keeper to fill");
const pos = await until("fill", async () => (await o.positions(me)).find((p) => !before.includes(p.id)));
console.log(`filled #${pos.id} at ${Number(pos.entry_price) / 1e8}`);

const entry = Number(pos.entry_price) / 1e8;
await fetch(`${CONTROL}/price`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ market: "NEAR-USD", price: entry * 0.98 }) });
console.log(`steering NEAR-USD to ${(entry * 0.98).toFixed(4)} (−2%); waiting for liquidation`);
await until("liquidation", async () => !(await o.positions(me)).some((p) => p.id === pos.id));
console.log(`liquidated. pending Extra Life: ${fmtUsdc(BigInt(await o.pendingLife(me)))} of losses this epoch`);

const s = await o.solvency();
console.log(`pool ${fmtUsdc(BigInt(s.pool))} · worst case ${fmtUsdc(BigInt(s.liability))} · reserve ${fmtUsdc(BigInt(s.reserve))}`);
