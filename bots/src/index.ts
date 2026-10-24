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
  aiAgents,
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
  /** Locks 5,000 $1UP of its own for two years. */
  collector?: boolean;
  /** How it uses the marketplace. */
  market?: {
    /** Lists its Extra Lives and locks, priced at a share of their value (lives, then locks). */
    sell?: { life: [number, number]; lock: [number, number] };
    /** Now and then locks some $1UP just to sell the lock. */
    makeLocks?: boolean;
    /** Buys listings priced at or under this share of their value, with this chance each step. */
    buy?: { upTo: number; chance: number };
  };
}

const sma = (xs: number[], n: number) => xs.slice(-n).reduce((a, b) => a + b, 0) / Math.min(n, xs.length);
const coin = (): Side => (Math.random() < 0.5 ? "Long" : "Short");
const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);

const STYLES: Style[] = [
  { name: "degen", side: coin, margin: [200, 800], leverage: [50, 100], takeProfit: 2, stopLoss: 0.95, maxHoldS: [90, 240], market: { sell: { life: [0.7, 0.9], lock: [0.5, 0.75] }, makeLocks: true } },
  {
    name: "trend",
    side: (h) => (h.length < 10 ? null : h.at(-1)! > sma(h, 10) ? "Long" : "Short"),
    margin: [500, 1500],
    leverage: [10, 25],
    takeProfit: 0.5,
    stopLoss: 0.4,
    maxHoldS: [120, 360],
    market: { sell: { life: [0.85, 1.05], lock: [0.7, 0.95] }, buy: { upTo: 0.9, chance: 0.15 } },
  },
  {
    name: "fader",
    side: (h) => (h.length < 10 ? null : h.at(-1)! > sma(h, 10) ? "Short" : "Long"),
    margin: [500, 1500],
    leverage: [10, 30],
    takeProfit: 0.4,
    stopLoss: 0.5,
    maxHoldS: [120, 300],
    market: { sell: { life: [0.8, 1], lock: [0.6, 0.9] }, makeLocks: true },
  },
  { name: "whale", side: coin, margin: [3_000, 8_000], leverage: [2, 5], takeProfit: 0.1, stopLoss: 0.1, maxHoldS: [180, 480], market: { sell: { life: [0.9, 1.1], lock: [0.8, 1] }, buy: { upTo: 0.85, chance: 0.25 } } },
  {
    name: "scalper",
    side: (h) => (h.length < 4 ? null : h.at(-1)! > h.at(-4)! ? "Long" : "Short"),
    margin: [200, 500],
    leverage: [20, 40],
    takeProfit: 0.2,
    stopLoss: 0.2,
    maxHoldS: [60, 100],
    market: { sell: { life: [0.75, 0.95], lock: [0.55, 0.85] }, makeLocks: true },
  },
  { name: "collector", side: coin, margin: [100, 300], leverage: [5, 10], takeProfit: 0.3, stopLoss: 0.3, maxHoldS: [120, 300], collector: true, market: { buy: { upTo: 0.65, chance: 1 } } },
  // bots 7–12 (pnpm bots:add on a running chain)
  {
    name: "momentum",
    side: (h) => (h.length < 30 ? null : h.at(-1)! > sma(h, 30) * 1.0005 ? "Long" : h.at(-1)! < sma(h, 30) * 0.9995 ? "Short" : null),
    margin: [300, 1_000],
    leverage: [15, 40],
    takeProfit: 0.6,
    stopLoss: 0.35,
    maxHoldS: [150, 420],
    market: { sell: { life: [0.8, 1], lock: [0.6, 0.9] } },
  },
  {
    name: "breakout",
    side: (h) => {
      if (h.length < 21) return null;
      const before = h.slice(-21, -1);
      return h.at(-1)! > Math.max(...before) ? "Long" : h.at(-1)! < Math.min(...before) ? "Short" : null;
    },
    margin: [400, 1_200],
    leverage: [20, 50],
    takeProfit: 0.8,
    stopLoss: 0.3,
    maxHoldS: [90, 300],
    market: { sell: { life: [0.75, 0.95], lock: [0.6, 0.85] }, makeLocks: true },
  },
  { name: "gambler", side: coin, margin: [20, 80], leverage: [100, 100], takeProfit: 3, stopLoss: 0.9, maxHoldS: [60, 150], market: { sell: { life: [0.6, 0.85], lock: [0.5, 0.7] } } },
  { name: "hodler", side: () => (Math.random() < 0.75 ? "Long" : "Short"), margin: [1_000, 3_000], leverage: [2, 4], takeProfit: 0.15, stopLoss: 0.15, maxHoldS: [600, 1_200], market: { buy: { upTo: 0.8, chance: 0.2 } } },
  { name: "swing", side: coin, margin: [500, 2_000], leverage: [8, 20], takeProfit: 0.35, stopLoss: 0.3, maxHoldS: [200, 500], market: { sell: { life: [0.85, 1.05], lock: [0.7, 0.95] }, buy: { upTo: 0.88, chance: 0.1 } } },
  {
    name: "contrarian",
    side: (h) => (h.length < 6 ? null : h.at(-1)! > h.at(-6)! * 1.001 ? "Short" : h.at(-1)! < h.at(-6)! * 0.999 ? "Long" : null),
    margin: [300, 900],
    leverage: [25, 60],
    takeProfit: 0.5,
    stopLoss: 0.6,
    maxHoldS: [90, 240],
    market: { sell: { life: [0.7, 0.9], lock: [0.55, 0.8] } },
  },
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
    const m = this.style.market;
    if (m?.buy && Math.random() < m.buy.chance) await this.shop(m.buy.upTo);
    if (m?.makeLocks) await this.makeLock();
    if (m?.sell) await this.sell(m.sell);
    await this.govern();
    // the collector backs the house only now and then, so the demo's round stays open for people to try
    if (this.style.collector && Math.random() < 0.002) await this.back();
  }

  /** The collector now and then backs the house with $1,000–5,000 while the bootstrap round is open (D-22). */
  private async back() {
    const amount = BigInt(1_000 + Math.floor(Math.random() * 4_000)) * USDC;
    const round = await o.backing(amount);
    if (!round.open || BigInt(round.backed) + amount > BigInt(round.target)) return;
    if (BigInt(await o.usdcBalance(this.id)) < amount) await this.tx.faucet(amount);
    await this.tx.back(amount).then(
      () => log(this.style.name, `backed the house with $${fmtUsdc(amount, 0)} at ${(Number(round.cap_ppm) / 1e6).toFixed(2)}×`),
      (e) => log(this.style.name, `backing failed: ${short(e)}`),
    );
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

  /** A council member (D-20) approves the house proposals it sees after a short look (10 s). */
  private async govern() {
    if (!d.contracts.dao) return;
    const policy = await o.daoPolicy().catch(() => null);
    const council = policy?.roles.flatMap((r) => (typeof r.kind === "object" && r.kind.Group ? r.kind.Group : [])) ?? [];
    if (!council.includes(this.id)) return;
    const now = BigInt(Date.now()) * 1_000_000n;
    for (const p of await o.daoProposals().catch(() => [])) {
      if (p.status !== "InProgress" || p.votes[this.id] || now - BigInt(p.submission_time) < 10_000_000_000n) continue;
      await this.tx.vote(p.id, "VoteApprove", p.kind).then(
        () => log(this.style.name, `voted for DAO proposal #${p.id}: ${p.description}`),
        (e) => log(this.style.name, `vote failed: ${short(e)}`),
      );
      return;
    }
  }

  /** Now and then (about once every ten steps) locks 500–2,000 $1UP for 13–104 epochs, to sell the lock. */
  private async makeLock() {
    if (Math.random() > 0.1) return;
    const spare = (await o.locks(this.id)).filter((l) => !l.withdrawn && !l.from_loss).length;
    if (spare >= 2 || BigInt(await o.oneupBalance(this.id)) < 2_000n * ONEUP) return;
    const amount = BigInt(Math.round(between([500, 2_000]))) * ONEUP;
    const epochs = Math.round(between([13, 104]));
    await this.tx.lock(amount, epochs).then(
      () => log(this.style.name, `locked ${fmtOneup(amount)} $1UP for ${epochs} epochs, to sell`),
      (e) => log(this.style.name, `lock failed: ${short(e)}`),
    );
  }

  /**
   * Keeps up to two listings up, priced at a random share of value. One that hasn't sold in five minutes is
   * re-priced 5% lower, down to 45% of value, so prices find buyers.
   */
  private async sell(share: { life: [number, number]; lock: [number, number] }) {
    const { life, ve } = d.contracts;
    const listings = await o.listings().catch(() => [] as Listing[]);
    const mine = listings.filter((x) => x.seller === this.id);
    const px = await oneupPrice();
    const now = Math.floor(Date.now() / 1000);
    for (const x of mine) {
      // Backer Lives are long-term backing (D-22): bots keep them
      if (x.nft_contract === life && x.token_id.startsWith("b")) {
        await this.tx.delist(life, x.token_id).catch(() => {});
        return;
      }
      // an expired life earns nothing more: take it down (its unclaimed USDC is claimed instead)
      if (x.nft_contract === life && (await o.lifeInfo(x.token_id).catch(() => null))?.expired) {
        await this.tx.delist(life, x.token_id).then(() => log(this.style.name, `delisted expired ${label(x)}`), () => {});
        return;
      }
      if (now - x.listed_at < 300) continue;
      const value = await valueOf(x, px);
      const next = (BigInt(x.price) * 95n) / 100n;
      if (value === 0n || next * 100n < value * 45n) continue;
      await this.tx.list(x.nft_contract, x.token_id, next).then(
        () => log(this.style.name, `re-priced ${label(x)} to $${fmtUsdc(next)}`),
        (e) => log(this.style.name, `re-price failed: ${short(e)}`),
      );
      return;
    }
    if (mine.length >= 2) return;
    const up = new Set(mine.map((x) => `${x.nft_contract}:${x.token_id}`));
    const offers: { nft: string; token: string; price: bigint; what: string }[] = [];
    for (const l of await o.lives(this.id)) {
      const v = lifeValue(l);
      if (v >= USDC && !l.backer && !l.expired && !up.has(`${life}:${l.token_id}`)) offers.push({ nft: life, token: l.token_id, price: share_(v, share.life), what: "Extra Life" });
    }
    for (const l of await o.locks(this.id)) {
      if (l.withdrawn || up.has(`${ve}:${l.token_id}`)) continue;
      const v = lockValue(l, px);
      if (v >= USDC) offers.push({ nft: ve, token: l.token_id, price: share_(v, share.lock), what: `lock #${l.token_id}` });
    }
    if (offers.length === 0) return;
    const x = offers[Math.floor(Math.random() * offers.length)];
    await this.tx.list(x.nft, x.token, x.price).then(
      () => log(this.style.name, `listed ${x.what} for $${fmtUsdc(x.price)}`),
      (e) => log(this.style.name, `listing failed: ${short(e)}`),
    );
  }

  /** Buys the best deal priced at or under `upTo` of its value, with wallet USDC. One purchase per step. */
  private async shop(upTo: number) {
    const listings = (await o.listings().catch(() => [] as Listing[])).filter((x) => x.seller !== this.id);
    if (listings.length === 0) return;
    const px = await oneupPrice();
    let best: { x: Listing; value: bigint; ratio: number } | null = null;
    for (const x of listings) {
      const value = await valueOf(x, px);
      if (value === 0n) continue;
      const ratio = Number(BigInt(x.price)) / Number(value);
      if (ratio <= upTo && (!best || ratio < best.ratio)) best = { x, value, ratio };
    }
    if (!best) return;
    const price = BigInt(best.x.price);
    const wallet = BigInt(await o.usdcBalance(this.id));
    if (wallet < price) await this.tx.faucet(10_000n * USDC);
    await this.tx.buy(best.x.nft_contract, best.x.token_id, price).then(
      () => log(this.style.name, `bought ${label(best.x)} for $${fmtUsdc(price)} (worth ~$${fmtUsdc(best.value)})`),
      (e) => log(this.style.name, `buy failed: ${short(e)}`),
    );
  }
}

/** What a listing is worth: USDC a life can still earn, or a lock's $1UP at the swap price. */
async function valueOf(x: Listing, px: bigint): Promise<bigint> {
  return x.nft_contract === d.contracts.life
    ? o.lifeInfo(x.token_id).then((l) => (l ? lifeValue(l) : 0n))
    : o.lockInfo(x.token_id).then((l) => (l && !l.withdrawn ? lockValue(l, px) : 0n));
}

const label = (x: Listing) => (x.nft_contract === d.contracts.life ? `Extra Life ${x.token_id}` : `lock #${x.token_id}`);
const share_ = (v: bigint, [a, b]: [number, number]) => (v * BigInt(Math.round(between([a, b]) * 1000))) / 1000n;
const fmtOneup = (x: bigint) => (Number(x / ONEUP)).toLocaleString("en-US");

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

// the accounts an AI agent drives through the MCP server (bot12 by default) are left to it
const ai = aiAgents(process.env.ONEUP_AI_AGENTS);
const bots = d.bots.map((b, i) => new Bot(b.id, b.key, STYLES[i % STYLES.length])).filter((b) => !ai.includes(b.id.split(".")[0]));
console.log(`${bots.length} bots on ${d.rpcUrl}: ${bots.map((b) => b.style.name).join(", ")}${ai.length ? ` (left to the AI agent: ${ai.join(", ")})` : ""}`);

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
