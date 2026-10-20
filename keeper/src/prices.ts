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

/** A market the keeper prices: the id and Pyth feed id as listed on chain. */
export interface Feed {
  id: string;
  feedId: string;
}

export interface PriceSource {
  next(markets: Feed[]): Promise<PushPrice[]>;
}

const EXPO = -8;
const toRaw = (usd: number) => Math.round(usd * 1e8);
const nowS = () => Math.floor(Date.now() / 1000);

/** Starting price for a market listed by vote with no configured sim price. */
const LISTED_START_PRICE = 0.25;

/** Gaussian random walk: each tick moves each market by `vol` (one standard deviation, as a fraction). */
export class SimSource implements PriceSource {
  readonly prices = new Map<string, number>();
  private targets = new Map<string, number>();

  constructor(configured: MarketConfig[], private vol = 0.0015) {
    for (const m of configured) this.prices.set(m.id, m.simPrice);
  }

  /** Moves a market toward `usd` over the next few ticks (so fills and liquidations see a path, not a jump). */
  steer(marketId: string, usd: number) {
    if (!this.prices.has(marketId)) throw new Error(`unknown market ${marketId}`);
    this.targets.set(marketId, usd);
  }

  async next(markets: Feed[]): Promise<PushPrice[]> {
    const t = nowS();
    return markets.map((m) => {
      if (!this.prices.has(m.id)) this.prices.set(m.id, LISTED_START_PRICE);
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

/** Live Pyth prices. Hermes now answers 401 without a bearer token: set PYTH_API_KEY. */
export class HermesSource implements PriceSource {
  constructor(private apiKey = process.env.PYTH_API_KEY, private url = "https://hermes.pyth.network") {}

  async next(markets: Feed[]): Promise<PushPrice[]> {
    const q = markets.map((m) => `ids[]=${m.feedId}`).join("&");
    const headers: Record<string, string> = this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
    const r = await fetch(`${this.url}/v2/updates/price/latest?${q}&parsed=true`, { headers });
    if (r.status === 401) throw new Error("Hermes needs an API key: set PYTH_API_KEY, or run with --prices sim");
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
