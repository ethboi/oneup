// The OneUp keeper: anyone can run one. Each tick it pushes prices, fills and expires orders, liquidates
// and takes profit at the cap, steps epoch closes, and (with the owner key) runs buybacks.
//
//   pnpm --filter @oneup/keeper start [--prices sim|hermes] [--tick 3000] [--price-tick 1000] [--control 8787]
//
// With sim prices, a control port on 127.0.0.1 lets a demo steer a market:
//   curl -XPOST localhost:8787/price -d '{"market":"NEAR-USD","price":2.45}'

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Account, KeyPair, actions, type KeyPairString } from "near-api-js";
import {
  OneUp,
  accountSender,
  atProfitCap,
  isLiquidatable,
  normalizePrice,
  pnl,
  type Deployment,
  type Position,
} from "@oneup/sdk";
import { HermesSource, SimSource, type PriceSource } from "./prices.ts";

const { values: args } = parseArgs({
  options: {
    prices: { type: "string", default: "sim" },
    tick: { type: "string", default: "3000" },
    "price-tick": { type: "string", default: "1000" },
    control: { type: "string", default: "8787" },
    config: { type: "string", default: resolve(import.meta.dirname, "../../localnet.json") },
  },
});

const d: Deployment = JSON.parse(readFileSync(args.config!, "utf8"));
const oneup = new OneUp(d);
const keeper = oneup.calls(accountSender(new Account(d.keeper.id, oneup.provider, d.keeper.key as KeyPairString)));
const owner = oneup.calls(accountSender(new Account(d.owner.id, oneup.provider, d.owner.key as KeyPairString)));
const FILL_WINDOW_S = 30;

const source: PriceSource = args.prices === "hermes" ? new HermesSource() : new SimSource(d.markets);
/** Markets as listed on chain (refreshed every tick, so markets listed by vote get prices too). */
let feeds = new Map<string, string>(d.markets.map((m) => [m.id, m.feedId]));
/** Latest pushed price per feed, 1e8 units, and its publish time. */
const latest = new Map<string, { price: bigint; time: number }>();

const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);
const nowS = () => Math.floor(Date.now() / 1000);

async function pushPrices(pusher: ReturnType<OneUp["calls"]>) {
  const listed = (await oneup.markets()).filter((m) => m.live);
  feeds = new Map(listed.map((m) => [m.id, m.feed_id]));
  const updates = await source.next(listed.map((m) => ({ id: m.id, feedId: m.feed_id })));
  await pusher.pushPrices(updates);
  for (const u of updates) {
    const p = normalizePrice(BigInt(u.price), u.expo);
    if (p !== null) latest.set(u.feed_id, { price: p, time: u.publish_time });
  }
}

async function handleOrders() {
  for (const o of await oneup.listOrders(0, 200)) {
    const label = "Open" in o.kind ? `open ${o.kind.Open.side} ${o.market_id}` : `close #${o.kind.Close.position_id}`;
    if (nowS() > o.placed_at + FILL_WINDOW_S) {
      await keeper.expire(o.id);
      log(`expired order ${o.id} (${label})`);
      continue;
    }
    const px = latest.get(feeds.get(o.market_id) ?? "");
    if (!px || px.time <= o.placed_at) continue; // wait for a price published after the order
    const ok = await keeper.fill(o.id);
    log(`${ok ? "filled" : "could not fill"} order ${o.id} (${label})`);
  }
}

async function handlePositions() {
  let all: Position[] = [];
  for (let from = 0; ; from += 100) {
    const page = await oneup.listPositions(from, 100);
    all = all.concat(page);
    if (page.length < 100) break;
  }
  for (const p of all) {
    const px = latest.get(feeds.get(p.market_id) ?? "");
    if (!px || px.time < p.entry_publish_time) continue;
    const margin = BigInt(p.margin);
    const v = pnl(p.side, margin, p.leverage, BigInt(p.entry_price), px.price);
    if (isLiquidatable(v, margin)) {
      const ok = await keeper.liquidate(p.id);
      log(`${ok ? "liquidated" : "could not liquidate"} #${p.id} ${p.owner} ${p.side} ${p.market_id} ${p.leverage}x`);
    } else if (atProfitCap(v, margin)) {
      const ok = await keeper.takeProfit(p.id);
      log(`${ok ? "took profit at cap" : "could not take profit"} #${p.id} ${p.owner}`);
    }
  }
}

async function handleEpoch() {
  const [epoch, closing] = await Promise.all([oneup.epoch(), oneup.closing()]);
  if (!closing && nowS() < epoch.started_at + d.epochLengthS) return;
  for (let i = 0; i < 20; i++) {
    const r = await keeper.closeEpoch();
    if (r === "begun") log(`epoch ${epoch.id} ended; closing`);
    if (r === "closed") {
      const e = (await oneup.epoch()).id - 1;
      const s = await oneup.epochSummary(e);
      log(`epoch ${e} closed: house net ${fmt(s?.house_net)}, ${s?.lives_minted} Extra Lives, lives pot ${fmt(s?.lives_pot)}, buyback ${fmt(s?.buyback_pot)}`);
      await runBuyback(e);
      return;
    }
    if (r === "waiting for mints") return; // next tick
  }
}

async function runBuyback(epoch: number) {
  const b = await oneup.buyback(epoch);
  if (!b || b.status !== "Pending") return;
  const quote = BigInt(await oneup.view<string>(d.contracts.swap, "get_quote", { usdc_in: b.usdc }));
  if (quote === 0n) return log(`buyback ${epoch}: swap has no liquidity`);
  await owner.buyback(epoch, (quote * 98n) / 100n);
  log(`buyback ${epoch}: ${fmt(b.usdc)} USDC → $1UP for lockers`);
}

const fmt = (x?: string) => (x === undefined ? "-" : (Number(x) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 }));

function controlServer(port: number) {
  if (!(source instanceof SimSource)) return;
  const sim = source;
  createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/prices") {
        res.end(JSON.stringify(Object.fromEntries(sim.prices)));
      } else if (req.method === "POST" && req.url === "/price") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { market, price, movePct } = JSON.parse(body);
        const target = price ?? sim.prices.get(market)! * (1 + movePct / 100);
        sim.steer(market, target);
        log(`steering ${market} → ${target}`);
        res.end(JSON.stringify({ market, target }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    } catch (e) {
      res.statusCode = 400;
      res.end(String(e));
    }
  })
    .on("error", (e) => log(`price control off: ${e.message}`))
    .listen(port, "127.0.0.1", () => log(`sim price control on http://127.0.0.1:${port}`));
}

/**
 * Prices go out on their own loop and their own key: a function-call key that can only call the oracle's
 * `push_prices`. A slow fill or epoch close then never holds up a price (or the app's chart), and the two
 * loops don't fight over one key's nonce.
 */
async function priceSender() {
  const kp = KeyPair.fromRandom("ed25519");
  const main = new Account(d.keeper.id, oneup.provider, d.keeper.key as KeyPairString);
  // no allowance: a capped key (the library's default is 0.25 NEAR) runs dry after about an hour of pushes
  await main.signAndSendTransaction({
    receiverId: d.keeper.id,
    actions: [actions.addFunctionCallAccessKey(kp.getPublicKey(), d.contracts.oracle, ["push_prices"])],
  });
  return oneup.calls(accountSender(new Account(d.keeper.id, oneup.provider, kp.toString() as KeyPairString)));
}

async function priceLoop(pusher: ReturnType<OneUp["calls"]>) {
  for (;;) {
    const start = Date.now();
    try {
      await pushPrices(pusher);
    } catch (e) {
      log(`prices: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
    await new Promise((r) => setTimeout(r, Math.max(0, Number(args["price-tick"]) - (Date.now() - start))));
  }
}

async function tick() {
  const steps: [string, () => Promise<void>][] = [
    ["orders", handleOrders],
    ["positions", handlePositions],
    ["epoch", handleEpoch],
  ];
  for (const [name, fn] of steps) {
    try {
      await fn();
    } catch (e) {
      log(`${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
  }
}

log(`keeper ${d.keeper.id} on ${d.rpcUrl}, ${args.prices} prices, ${d.markets.length} markets`);
controlServer(Number(args.control));
void priceLoop(await priceSender());
for (;;) {
  const start = Date.now();
  await tick();
  await new Promise((r) => setTimeout(r, Math.max(0, Number(args.tick) - (Date.now() - start))));
}
