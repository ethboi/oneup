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
  PPM,
  USDC,
  accountSender,
  fmtUsdc,
  normalizePrice,
  pnl,
  type Deployment,
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
  votes?: boolean;
}

const sma = (xs: number[], n: number) => xs.slice(-n).reduce((a, b) => a + b, 0) / Math.min(n, xs.length);
const coin = (): Side => (Math.random() < 0.5 ? "Long" : "Short");
const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);

const STYLES: Style[] = [
  { name: "degen", side: coin, margin: [200, 800], leverage: [50, 100], takeProfit: 2, stopLoss: 0.95, maxHoldS: [90, 240] },
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
  { name: "whale", side: coin, margin: [5_000, 15_000], leverage: [2, 5], takeProfit: 0.1, stopLoss: 0.1, maxHoldS: [180, 480] },
  {
    name: "scalper",
    side: (h) => (h.length < 4 ? null : h.at(-1)! > h.at(-4)! ? "Long" : "Short"),
    margin: [200, 500],
    leverage: [20, 40],
    takeProfit: 0.2,
    stopLoss: 0.2,
    maxHoldS: [60, 100],
  },
  { name: "voter", side: coin, margin: [100, 300], leverage: [5, 10], takeProfit: 0.3, stopLoss: 0.3, maxHoldS: [120, 300], votes: true },
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
    if (this.style.votes && !this.locked) await this.lockAndVote();
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
      await this.tx.placeOpen(m.id, side, margin, leverage);
      log(this.style.name, `open ${side} ${m.id} ${leverage}x $${fmtUsdc(margin, 0)}`);
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
    if (epochs.length && BigInt(await o.claimableEmissions(this.id, epochs)) > 0n) {
      await this.tx.claimEmissions(epochs).then(
        () => log(this.style.name, "claimed $1UP emissions"),
        (e) => log(this.style.name, `emissions claim failed: ${short(e)}`),
      );
    }
    for (const l of await o.locks(this.id)) {
      if ((await o.veClaimable(l.token_id, epochs)).length) {
        await this.tx.claimVe(l.token_id, epochs).then(
          () => log(this.style.name, `claimed voter rewards for lock #${l.token_id}`),
          (e) => log(this.style.name, `ve claim failed: ${short(e)}`),
        );
      }
    }
  }

  private async lockAndVote() {
    this.locked = true;
    const markets = (await o.markets()).map((m) => m.id);
    if ((await o.locks(this.id)).length === 0) {
      await this.tx.lock(5_000n * ONEUP, 52);
      log(this.style.name, "locked 5,000 $1UP for 52 epochs");
    }
    const lock = (await o.locks(this.id))[0];
    // 50% to the first market, the rest split evenly
    const rest = markets.slice(1);
    const each = rest.length ? (PPM / 2n) / BigInt(rest.length) : 0n;
    const alloc: [string, bigint][] = [[markets[0], PPM - each * BigInt(rest.length)], ...rest.map((m): [string, bigint] => [m, each])];
    await this.tx.vote(lock.token_id, alloc);
    log(this.style.name, `voted ${alloc.map(([m, a]) => `${m} ${Number(a) / 1e4}%`).join(", ")}`);
  }
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
