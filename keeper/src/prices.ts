// Price sources for the keeper's oracle pushes. `sim` is a random walk you can steer (local demos);
// `hermes` is live Pyth prices from the public Hermes API.

import type { MarketConfig } from "@oneup/sdk";

export interface PushPrice {
  feed_id: string;
  price: number;
  conf: number;
  expo: number;
  publish_time: number;
}

export interface PriceSource {
  next(): Promise<PushPrice[]>;
}

const EXPO = -8;
const toRaw = (usd: number) => Math.round(usd * 1e8);
const nowS = () => Math.floor(Date.now() / 1000);

/** Gaussian random walk: each tick moves each market by `vol` (one standard deviation, as a fraction). */
export class SimSource implements PriceSource {
  readonly prices = new Map<string, number>();
  private targets = new Map<string, number>();

  constructor(private markets: MarketConfig[], private vol = 0.0015) {
    for (const m of markets) this.prices.set(m.id, m.simPrice);
  }

  /** Moves a market toward `usd` over the next few ticks (so fills and liquidations see a path, not a jump). */
  steer(marketId: string, usd: number) {
    if (!this.prices.has(marketId)) throw new Error(`unknown market ${marketId}`);
    this.targets.set(marketId, usd);
  }

  async next(): Promise<PushPrice[]> {
    const t = nowS();
    return this.markets.map((m) => {
      let p = this.prices.get(m.id)!;
      const target = this.targets.get(m.id);
      if (target !== undefined) {
        const step = (target - p) / 3;
        p = Math.abs(target - p) / target < 0.0005 ? target : p + step;
        if (p === target) this.targets.delete(m.id);
      } else {
        p *= Math.exp(this.vol * gaussian());
      }
      this.prices.set(m.id, p);
      const raw = toRaw(p);
      return { feed_id: m.feedId, price: raw, conf: Math.round(raw * 0.0005), expo: EXPO, publish_time: t };
    });
  }
}

export class HermesSource implements PriceSource {
  constructor(private markets: MarketConfig[], private url = "https://hermes.pyth.network") {}

  async next(): Promise<PushPrice[]> {
    const q = this.markets.map((m) => `ids[]=${m.feedId}`).join("&");
    const r = await fetch(`${this.url}/v2/updates/price/latest?${q}&parsed=true`);
    if (!r.ok) throw new Error(`Hermes ${r.status}`);
    const body = (await r.json()) as { parsed: { id: string; price: { price: string; conf: string; expo: number; publish_time: number } }[] };
    return body.parsed.map((p) => ({
      feed_id: p.id.replace(/^0x/, ""),
      price: Number(p.price.price),
      conf: Number(p.price.conf),
      expo: p.price.expo,
      // Hermes times are real time; the local chain's clock is too, so these satisfy the fill rules.
      publish_time: p.price.publish_time,
    }));
  }
}

function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
