// The $1UP price over time: sampled from the swap once a minute and kept for a day, so the Locks tab can show
// where it's been. Saved to .localnet/oneup-price.json (wiped with the chain). Localnet only, like the indexer.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ONEUP, OneUp, USDC } from "@oneup/sdk";
import { deployment } from "./localnet";

const SAVE = resolve(process.cwd(), "../.localnet/oneup-price.json");
const EVERY_MS = 60_000;
const KEEP = 24 * 60;

/** [ms, USDC (1e6) per whole $1UP]. */
type Sample = [number, number];

const g = globalThis as { __oneupPrice?: { samples: Sample[]; running: boolean } };
const state = (g.__oneupPrice ??= { samples: load(), running: false });

function load(): Sample[] {
  try {
    return existsSync(SAVE) ? (JSON.parse(readFileSync(SAVE, "utf8")) as Sample[]) : [];
  } catch {
    return [];
  }
}

async function sample(o: OneUp) {
  // the same quote as the app's useOneupPrice: what 100 USDC buys
  const out = BigInt(await o.swapQuote(100n * USDC));
  if (out <= 0n) return;
  const px = Number((100n * USDC * ONEUP) / out);
  state.samples.push([Date.now(), px]);
  if (state.samples.length > KEEP) state.samples.splice(0, state.samples.length - KEEP);
  try {
    writeFileSync(SAVE, JSON.stringify(state.samples));
  } catch {
    // disk trouble: keep going in memory
  }
}

export function startOneupPrice() {
  if (state.running) return;
  state.running = true;
  const o = new OneUp(deployment());
  const loop = () => void sample(o).catch(() => {}).finally(() => setTimeout(loop, EVERY_MS));
  loop();
}

export const oneupPrices = () => state.samples;
