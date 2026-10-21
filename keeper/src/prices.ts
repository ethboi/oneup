// Price sources for the keeper's oracle pushes. `live` is real market prices from Binance's public API
// (Coinbase if Binance fails) that a demo can still push around; `sim` is a random walk you can steer
// (offline demos); `hermes` is Pyth prices from Hermes, which needs PYTH_API_KEY.

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

/** A source the keeper's control server can push around: `prices` are the last ones sent. */
export interface Steerable {
  readonly prices: Map<string, number>;
  steer(marketId: string, usd: number): void;
}

/** Starting price for a market listed by vote with no configured sim price. */
const LISTED_START_PRICE = 0.25;

/** Gaussian random walk: each tick moves each market by `vol` (one standard deviation, as a fraction). */
export class SimSource implements PriceSource, Steerable {
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

/**
 * Real prices, with a per-market multiplier so a demo can still crash or pump a market. A steer eases the
 * multiplier to its target over a few ticks and holds it for 30 seconds (so fills and liquidations see it),
 * then it drifts back to 1 (half-life about 30 ticks) and the market returns to the real price.
 */
export class LiveSource implements PriceSource, Steerable {
  readonly prices = new Map<string, number>();
  private offsets = new Map<string, number>();
  private targets = new Map<string, number>();
  private holdUntil = new Map<string, number>();

  steer(marketId: string, usd: number) {
    const now = this.prices.get(marketId);
    if (now === undefined) throw new Error(`no price yet for ${marketId}`);
    this.targets.set(marketId, (this.offsets.get(marketId) ?? 1) * (usd / now));
    this.holdUntil.delete(marketId);
  }

  async next(markets: Feed[]): Promise<PushPrice[]> {
    const real = await fetchReal(markets.map((m) => m.id));
    const t = nowS();
    return markets.map((m) => {
      const r = real.get(m.id);
      if (r === undefined) throw new Error(`no live price for ${m.id}`);
      let k = this.offsets.get(m.id) ?? 1;
      const target = this.targets.get(m.id);
      if (target !== undefined) {
        k += (target - k) / 3;
        if (Math.abs(target - k) < 0.0005) (k = target), this.targets.delete(m.id), this.holdUntil.set(m.id, t + 30);
      } else if (t < (this.holdUntil.get(m.id) ?? 0)) {
        // holding the steered level
      } else {
        k = Math.abs(k - 1) < 0.0005 ? 1 : 1 + (k - 1) * 0.977;
      }
      this.offsets.set(m.id, k);
      const p = r * k;
      this.prices.set(m.id, p);
      const raw = toRaw(p);
      return { feed_id: m.feedId, price: raw, conf: Math.round(raw * 0.0005), expo: EXPO, publish_time: t };
    });
  }
}

/** "NEAR-USD" → Binance's NEARUSDT (USDT is close enough to USD for a demo) and Coinbase's NEAR-USD. */
async function fetchReal(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const symbols = encodeURIComponent(JSON.stringify(ids.map((id) => `${id.split("-")[0]}USDT`)));
    const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${symbols}`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    const rows = (await r.json()) as { symbol: string; price: string }[];
    for (const id of ids) {
      const row = rows.find((x) => x.symbol === `${id.split("-")[0]}USDT`);
      if (row) out.set(id, Number(row.price));
    }
  } catch {
    // fall through to Coinbase for whatever is missing
  }
  await Promise.all(
    ids
      .filter((id) => !out.has(id))
      .map(async (id) => {
        const r = await fetch(`https://api.coinbase.com/v2/prices/${id}/spot`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
        const j = r?.ok ? ((await r.json()) as { data?: { amount?: string } }) : null;
        if (j?.data?.amount) out.set(id, Number(j.data.amount));
      }),
  );
  return out;
}

function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
