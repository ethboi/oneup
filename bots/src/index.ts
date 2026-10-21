// Demo trading agents: rule-based bots that make real volume on the local chain, so epochs close with
// winners, losers, Extra Lives, emissions and buybacks. Each bot trades from its own account.
//
//   pnpm bots            (needs `pnpm localnet` and `pnpm keeper` running)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, type KeyPairString } from "near-api-js";
import {
  ONEUP,
  OneUp,
  USDC,
  accountSender,
  fmtUsdc,
  normalizePrice,
  pnl,
  type Deployment,
  type LifeInfo,
  type Listing,
  type LockInfo,
  type Position,
  type Side,
} from "@oneup/sdk";

const d: Deployment = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../localnet.json"), "utf8"));
const o = new OneUp(d);
const MIN_HOLD_S = 60;

interface Style {
  name: string;
  /** Picks a side from recent prices (oldest first), or null to sit out. */
  side: (history: number[]) => Side | null;
  margin: [number, number];
  leverage: [number, number];
  /** Close at +takeProfit or −stopLoss (fractions of margin), or after maxHoldS. */
  takeProfit: number;
  stopLoss: number;
  maxHoldS: [number, number];
  /** Locks $1UP and buys Extra Lives and locks on the marketplace when they're cheap. */
  collector?: boolean;
  /** Sells its Extra Lives and loss-locks on the marketplace for quick cash. */
  seller?: boolean;
}

const sma = (xs: number[], n: number) => xs.slice(-n).reduce((a, b) => a + b, 0) / Math.min(n, xs.length);
const coin = (): Side => (Math.random() < 0.5 ? "Long" : "Short");
const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);

const STYLES: Style[] = [
  { name: "degen", side: coin, margin: [200, 800], leverage: [50, 100], takeProfit: 2, stopLoss: 0.95, maxHoldS: [90, 240], seller: true },
  {
    name: "trend",
    side: (h) => (h.length < 10 ? null : h.at(-1)! > sma(h, 10) ? "Long" : "Short"),
    margin: [500, 1500],
    leverage: [10, 25],
    takeProfit: 0.5,
    stopLoss: 0.4,
    maxHoldS: [120, 360],
  },
  {
    name: "fader",
    side: (h) => (h.length < 10 ? null : h.at(-1)! > sma(h, 10) ? "Short" : "Long"),
    margin: [500, 1500],
    leverage: [10, 30],
    takeProfit: 0.4,
    stopLoss: 0.5,
    maxHoldS: [120, 300],
  },
  { name: "whale", side: coin, margin: [3_000, 8_000], leverage: [2, 5], takeProfit: 0.1, stopLoss: 0.1, maxHoldS: [180, 480] },
  {
    name: "scalper",
    side: (h) => (h.length < 4 ? null : h.at(-1)! > h.at(-4)! ? "Long" : "Short"),
    margin: [200, 500],
    leverage: [20, 40],
    takeProfit: 0.2,
    stopLoss: 0.2,
    maxHoldS: [60, 100],
  },
  { name: "collector", side: coin, margin: [100, 300], leverage: [5, 10], takeProfit: 0.3, stopLoss: 0.3, maxHoldS: [120, 300], collector: true },
];

/** Shared price history per market, sampled every few seconds. */
const history = new Map<string, number[]>();
const latest = new Map<string, bigint>();

async function samplePrices() {
  for (const m of await o.markets()) {
    const p = await o.price(m.feed_id).catch(() => null);
    const v = p && normalizePrice(BigInt(p.price), p.expo);
    if (!v) continue;
    latest.set(m.id, v);
    const h = (history.get(m.id) ?? []).concat(Number(v) / 1e8).slice(-60);
    history.set(m.id, h);
  }
}

const log = (who: string, ...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), who.padEnd(8), ...m);
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).match(/panicked: ([^"\n]+)/)?.[1] ?? String(e).slice(0, 120);

class Bot {
  readonly tx: ReturnType<OneUp["calls"]>;
  private holdFor = new Map<number, number>();
  private lastClaim = 0;
  private locked = false;

  constructor(readonly id: string, key: string, readonly style: Style) {
    this.tx = o.calls(accountSender(new Account(id, o.provider, key as KeyPairString)));
  }

  async step() {
    await this.topUp();
    const [positions, orders] = await Promise.all([o.positions(this.id), o.orders(this.id)]);
    if (orders.length > 0) return; // something pending; wait for the keeper
    for (const p of positions) await this.maybeClose(p);
    if (positions.length === 0) await this.maybeOpen();
    if (Date.now() - this.lastClaim > 120_000) await this.claims();
    if (this.style.collector && !this.locked) await this.lock();
    if (this.style.collector) await this.shop();
    if (this.style.seller) await this.sell();
  }

  private async topUp() {
    const free = BigInt(await o.balance(this.id));
    if (free >= 2_000n * USDC) return;
    const wallet = BigInt(await o.usdcBalance(this.id));
    if (wallet < 10_000n * USDC) await this.tx.faucet(10_000n * USDC);
    await this.tx.deposit(10_000n * USDC);
    log(this.style.name, "deposited 10,000");
  }

  private async maybeOpen() {
    const markets = (await o.markets()).filter((m) => m.live && latest.has(m.id));
    if (markets.length === 0 || Math.random() < 0.3) return;
    const m = markets[Math.floor(Math.random() * markets.length)];
    const side = this.style.side(history.get(m.id) ?? []);
    if (!side) return;
    const margin = BigInt(Math.round(between(this.style.margin))) * USDC;
    const leverage = Math.min(m.max_leverage, Math.round(between(this.style.leverage)));
    const q = await o.quoteOpen(m.id, side, margin, leverage);
    if (!q.allowed) return log(this.style.name, `skip ${m.id}: ${q.reason}`);
    try {
      // half the time, a take-profit at +40% of margin and a stop at −30%, like a careful trader
      const px = latest.get(m.id)!;
      const at = (roe: number) => (px * BigInt(Math.round((1 + ((side === "Long" ? 1 : -1) * roe) / leverage) * 1e6))) / 1_000_000n;
      const triggers = Math.random() < 0.5 ? { takeProfit: at(0.4), stopLoss: at(-0.3) } : {};
      await this.tx.placeOpen(m.id, side, margin, leverage, triggers);
      log(this.style.name, `open ${side} ${m.id} ${leverage}x $${fmtUsdc(margin, 0)}${"takeProfit" in triggers ? " with TP/SL" : ""}`);
    } catch (e) {
      log(this.style.name, `open failed: ${short(e)}`);
    }
  }

  private async maybeClose(p: Position) {
    if (p.close_order !== null) return;
    const now = Math.floor(Date.now() / 1000);
    if (now < p.opened_at + MIN_HOLD_S) return;
    const mark = latest.get(p.market_id);
    if (!mark) return;
    const margin = BigInt(p.margin);
    const v = Number(pnl(p.side, margin, p.leverage, BigInt(p.entry_price), mark)) / Number(margin);
    if (!this.holdFor.has(p.id)) this.holdFor.set(p.id, between(this.style.maxHoldS));
    const timeUp = now - p.opened_at > this.holdFor.get(p.id)!;
    if (v >= this.style.takeProfit || v <= -this.style.stopLoss || timeUp) {
      try {
        await this.tx.placeClose(p.id);
        log(this.style.name, `close #${p.id} ${p.market_id} at ${(v * 100).toFixed(0)}% of margin`);
      } catch (e) {
        log(this.style.name, `close failed: ${short(e)}`);
      }
    }
  }

  private async claims() {
    this.lastClaim = Date.now();
    const lives = (await o.lives(this.id)).filter((l) => BigInt(l.claimable) > 0n);
    if (lives.length) {
      const total = lives.reduce((s, l) => s + BigInt(l.claimable), 0n);
      await this.tx.claimLives(lives.map((l) => l.token_id)).then(
        () => log(this.style.name, `claimed $${fmtUsdc(total)} from ${lives.length} Extra Lives`),
        (e) => log(this.style.name, `life claim failed: ${short(e)}`),
      );
    }
    const epoch = (await o.epoch()).id;
    const epochs = Array.from({ length: Math.min(10, epoch - 1) }, (_, i) => epoch - 1 - i);
    for (const l of await o.locks(this.id)) {
      if (epochs.length && BigInt(await o.veClaimable(l.token_id, epochs)) > 0n) {
        await this.tx.claimVe(l.token_id, epochs).then(
          () => log(this.style.name, `claimed lock rewards for #${l.token_id}`),
          (e) => log(this.style.name, `lock claim failed: ${short(e)}`),
        );
      }
    }
  }

  private async lock() {
    this.locked = true;
    if ((await o.locks(this.id)).some((l) => !l.from_loss)) return;
    await this.tx.lock(5_000n * ONEUP, 104);
    log(this.style.name, "locked 5,000 $1UP for 104 epochs");
  }

  private listed = new Set<string>();

  /** Lists Extra Lives at 70% of the USDC they can still earn, and loss-locks at 40% of their $1UP value. */
  private async sell() {
    const { life, ve } = d.contracts;
    for (const l of await o.lives(this.id)) {
      const left = lifeValue(l);
      if (left < USDC || this.listed.has(l.token_id)) continue;
      this.listed.add(l.token_id);
      const price = (left * 70n) / 100n;
      await this.tx.list(life, l.token_id, price).then(
        () => log(this.style.name, `listed Extra Life ${l.token_id} for $${fmtUsdc(price)}`),
        (e) => log(this.style.name, `listing failed: ${short(e)}`),
      );
    }
    const px = await oneupPrice();
    for (const l of await o.locks(this.id)) {
      if (!l.from_loss || l.withdrawn || this.listed.has(`lock${l.token_id}`)) continue;
      this.listed.add(`lock${l.token_id}`);
      const price = (lockValue(l, px) * 40n) / 100n;
      if (price < USDC) continue;
      await this.tx.list(ve, l.token_id, price).then(
        () => log(this.style.name, `listed lock #${l.token_id} for $${fmtUsdc(price)}`),
        (e) => log(this.style.name, `listing failed: ${short(e)}`),
      );
    }
  }

  /** Buys listings priced at or under 75% of their value, with wallet USDC. */
  private async shop() {
    const listings = (await o.listings().catch(() => [] as Listing[])).filter((x) => x.seller !== this.id);
    if (listings.length === 0) return;
    const px = await oneupPrice();
    for (const x of listings) {
      const value =
        x.nft_contract === d.contracts.life
          ? await o.lifeInfo(x.token_id).then((l) => (l ? lifeValue(l) : 0n))
          : await o.lockInfo(x.token_id).then((l) => (l && !l.withdrawn ? lockValue(l, px) : 0n));
      const price = BigInt(x.price);
      if (value === 0n || price * 4n > value * 3n) continue;
      const wallet = BigInt(await o.usdcBalance(this.id));
      if (wallet < price) await this.tx.faucet(10_000n * USDC);
      const what = x.nft_contract === d.contracts.life ? `Extra Life ${x.token_id}` : `lock #${x.token_id}`;
      await this.tx.buy(x.nft_contract, x.token_id, price).then(
        () => log(this.style.name, `bought ${what} for $${fmtUsdc(price)} (worth ~$${fmtUsdc(value)})`),
        (e) => log(this.style.name, `buy failed: ${short(e)}`),
      );
      return; // one purchase per step
    }
  }
}

/** USDC an Extra Life can still earn (0 once it has expired or healed fully). */
function lifeValue(l: LifeInfo): bigint {
  if (l.expired || l.full_heal) return BigInt(l.claimable);
  return BigInt(l.owed) - BigInt(l.paid) + BigInt(l.claimable);
}

/** USDC per whole $1UP, from the swap (1e6 units). */
async function oneupPrice(): Promise<bigint> {
  const out = BigInt(await o.swapQuote(100n * USDC).catch(() => "0"));
  return out === 0n ? 0n : (100n * USDC * ONEUP) / out;
}

/** What a lock is worth if you left it today: its $1UP after the exit penalty, at the swap price. */
function lockValue(l: LockInfo, px: bigint): bigint {
  const keep = BigInt(l.amount) - BigInt(l.exit_penalty);
  return (keep * px) / ONEUP;
}

const bots = d.bots.map((b, i) => new Bot(b.id, b.key, STYLES[i % STYLES.length]));
console.log(`${bots.length} bots on ${d.rpcUrl}: ${bots.map((b) => b.style.name).join(", ")}`);

setInterval(() => samplePrices().catch(() => {}), 3000);
await samplePrices();

for (const [i, b] of bots.entries()) {
  // stagger the bots so their transactions don't all land in the same block
  setTimeout(async function loop() {
    try {
      await b.step();
    } catch (e) {
      log(b.style.name, short(e));
    }
    setTimeout(loop, 8_000 + Math.random() * 12_000);
  }, i * 1500);
}
