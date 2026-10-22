// Recent prices for the chart, so a page that has just opened draws the last 30 minutes instead of a blank
// screen. Polls the oracle once a second, like the browser does (lib/oneup.tsx), and keeps a point only when
// a new price is published.

import { OneUp, normalizePrice } from "@oneup/sdk";
import { deployment } from "./localnet";

export type Point = { t: number; p: number };

/** 30 minutes, the longest chart window. */
const KEEP_MS = 30 * 60_000;

type State = { running: boolean; history: Map<string, Point[]>; published: Map<string, number> };
const g = globalThis as unknown as { __oneupPrices?: State };
const state: State = (g.__oneupPrices ??= { running: false, history: new Map(), published: new Map() });

async function step(o: OneUp) {
  const markets = await o.markets();
  const t = Date.now();
  await Promise.all(
    markets.map(async (m) => {
      const p = await o.price(m.feed_id).catch(() => null);
      const v = p && normalizePrice(BigInt(p.price), p.expo);
      if (!v || state.published.get(m.id) === p.publish_time) return;
      state.published.set(m.id, p.publish_time);
      const h = (state.history.get(m.id) ?? []).concat({ t, p: Number(v) / 1e8 });
      state.history.set(m.id, h.filter((x) => x.t >= t - KEEP_MS));
    }),
  );
}

export function startPrices() {
  if (state.running) return;
  state.running = true;
  let o: OneUp | null = null;
  let rpc = "";
  const loop = async () => {
    try {
      // localnet.json changes on a reset: follow it
      const d = deployment();
      if (!o || d.rpcUrl !== rpc || o.d.contracts.house !== d.contracts.house) {
        o = new OneUp(d);
        rpc = d.rpcUrl;
      }
      await step(o);
    } catch {
      // chain down or mid-reset: try again next second
    }
    setTimeout(loop, 1000);
  };
  void loop();
}

export function recentPrices(): Record<string, Point[]> {
  return Object.fromEntries(state.history);
}
