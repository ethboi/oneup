// The OneUp keeper: anyone can run one. Each tick it pushes prices, fills and expires orders, liquidates,
// takes profit at the cap, fires traders' take-profits and stop-losses, steps epoch closes, and (with the
// owner key) runs buybacks.
//
//   pnpm --filter @oneup/keeper start [--prices live|sim|hermes] [--tick 3000] [--price-tick 1000] [--control 8787]
//
// With live or sim prices, a control port on 127.0.0.1 lets a demo steer a market:
//   curl -XPOST localhost:8787/price -H 'content-type: application/json' -d '{"market":"NEAR-USD","price":2.45}'
// (JSON only, no browser Origin, moves within ±50%: see control.ts)

import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Account, KeyPair, actions, type KeyPairString } from "near-api-js";
import {
  OneUp,
  USDC,
  accountSender,
  atProfitCap,
  isLiquidatable,
  normalizePrice,
  pnl,
  stopHit,
  targetHit,
  type Deployment,
  type Position,
} from "@oneup/sdk";
import { HermesSource, LiveSource, SimSource, sane, type PriceSource, type Steerable } from "./prices.ts";
import { validSteer } from "./control.ts";
import { processOrders } from "./orders.ts";

const { values: args } = parseArgs({
  options: {
    prices: { type: "string", default: "live" },
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
const params = await oneup.params();
const FILL_WINDOW_S = params.fill_window_s ?? 30;
// D-30: a limit order rests this long before it can be expired
const LIMIT_EXPIRY_S = params.limit_expiry_s ?? 24 * 3600;
const minHoldS = params.min_hold_s;

const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);
const nowS = () => Math.floor(Date.now() / 1000);

const source: PriceSource =
  args.prices === "hermes" ? new HermesSource() : args.prices === "sim" ? new SimSource(d.markets) : new LiveSource(log);
/** Markets as listed on chain (refreshed every tick, so markets listed by vote get prices too). */
let feeds = new Map<string, string>(d.markets.map((m) => [m.id, m.feedId]));
/** Latest pushed price per feed, 1e8 units, and its publish time. */
const latest = new Map<string, { price: bigint; time: number }>();
/** Ticks in a row a feed's price has jumped: a jump that holds this long is the market, not a bad print. */
const jumps = new Map<string, number>();
const JUMP_TICKS = 10;

async function pushPrices(pusher: ReturnType<OneUp["calls"]>) {
  const listed = (await oneup.markets()).filter((m) => m.live);
  feeds = new Map(listed.map((m) => [m.id, m.feed_id]));
  const updates = (await source.next(listed.map((m) => ({ id: m.id, feedId: m.feed_id })))).filter((u) => {
    const last = latest.get(u.feed_id);
    const why = sane(last && Number(last.price) / 1e8, u.price * 10 ** u.expo);
    const n = why?.startsWith("jump") ? (jumps.get(u.feed_id) ?? 0) + 1 : 0;
    jumps.set(u.feed_id, n);
    if (!why || n > JUMP_TICKS) return true;
    log(`price for ${listed.find((m) => m.feed_id === u.feed_id)?.id ?? u.feed_id} not pushed: ${why}`);
    return false;
  });
  if (!updates.length) return;
  await pusher.pushPrices(updates);
  for (const u of updates) {
    const p = normalizePrice(BigInt(u.price), u.expo);
    if (p !== null) latest.set(u.feed_id, { price: p, time: u.publish_time });
  }
}

async function handleOrders() {
  await processOrders(oneup.listOrders, keeper, feeds, latest, nowS, FILL_WINDOW_S, LIMIT_EXPIRY_S, log);
}

/** Liquidations, take-profits at the cap and trigger hits. They run on their own fast loop and key (riskLoop):
 *  at 1000× a 0.09% move liquidates, so waiting behind a batch of fills would leave positions past it. */
async function handlePositions(risk: ReturnType<OneUp["calls"]>) {
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
      const ok = await risk.liquidate(p.id);
      log(`${ok ? "liquidated" : "could not liquidate"} #${p.id} ${p.owner} ${p.side} ${p.market_id} ${p.leverage}x`);
    } else if (atProfitCap(v, margin)) {
      const ok = await risk.takeProfit(p.id);
      log(`${ok ? "took profit at cap" : "could not take profit"} #${p.id} ${p.owner}`);
    } else if (p.close_order === null && nowS() >= p.opened_at + minHoldS && px.time > p.triggers_set_at) {
      // the trader's own triggers: after the minimum hold, on a price newer than when they were set. A hit
      // places a close, which handleOrders fills at the next price (D-19)
      const { take_profit: tp, stop_loss: sl } = p.triggers;
      if (tp && targetHit(p.side, px.price, BigInt(tp))) {
        const ok = await risk.hitTarget(p.id);
        log(`${ok ? "take-profit hit, close placed for" : "could not hit take-profit"} #${p.id} ${p.owner}`);
      } else if (sl && stopHit(p.side, px.price, BigInt(sl))) {
        const ok = await risk.hitStop(p.id);
        log(`${ok ? "stop-loss hit, close placed for" : "could not hit stop-loss"} #${p.id} ${p.owner}`);
      }
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
    if (r === "waiting for mints" || r === "waiting for recall") return; // next tick
  }
}

/** D-27: keeps the house's idle pool in the vault, recalls it when more must be on hand, and brings the
 *  interest home into the jackpot about once a minute. */
let lastHarvest = 0;
async function handleTreasury() {
  if (!d.contracts.vault) return;
  const t = await oneup.treasury();
  const deployed = BigInt(t.deployed);
  const allowed = BigInt(t.deployable);
  const step = 1_000n * USDC; // not worth a transaction below this
  // aim for 80% of the limit, so new trades don't force a recall every few seconds
  const target = (allowed * 8n) / 10n;
  if (deployed > allowed) {
    await keeper.recall(deployed - target);
    log(`treasury: recalled ${fmt((deployed - target).toString())} (more must be on hand)`);
  } else if (target > deployed && target - deployed >= step) {
    await keeper.deployToVault(target - deployed);
    log(`treasury: deployed ${fmt((target - deployed).toString())} to the vault`);
  }
  if (Date.now() - lastHarvest > 60_000) {
    lastHarvest = Date.now();
    const dep = await oneup.vaultDeposit();
    if (dep && BigInt(dep.interest) >= USDC) {
      await keeper.harvest();
      log(`treasury: ${fmt(dep.interest)} of interest into the jackpot`);
    }
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
  if (!(source instanceof SimSource || source instanceof LiveSource)) return;
  const sim: Steerable = source;
  createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/prices") {
        res.end(JSON.stringify(Object.fromEntries(sim.prices)));
      } else if (req.method === "POST" && req.url === "/price") {
        let body = "";
        for await (const chunk of req) if ((body += chunk).length > 1024) throw new Error("too large");
        const v = validSteer(body, req.headers, sim.prices);
        if ("error" in v) {
          res.statusCode = v.status;
          return void res.end(v.error);
        }
        const { market, target } = v;
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
    .listen(port, "127.0.0.1", () => log(`price control on http://127.0.0.1:${port}`));
}

/**
 * Prices go out on their own loop and their own key: a function-call key that can only call the oracle's
 * `push_prices`. A slow fill or epoch close then never holds up a price (or the app's chart), and the two
 * loops don't fight over one key's nonce.
 */
async function priceSender() {
  return keySender("keeper-price-key", d.contracts.oracle, ["push_prices"]);
}

/** The risk loop's own key: it can only liquidate, take profit at the cap and fire triggers on the house. */
async function riskSender() {
  return keySender("keeper-risk-key", d.contracts.house, ["liquidate", "take_profit", "hit_target", "hit_stop"]);
}

/** A sender on the keeper account through a function-call key limited to `methods` on `receiver`. */
async function keySender(file: string, receiver: string, methods: string[]) {
  // the key is kept beside the chain's state (.localnet/, wiped with it), so a restart reuses it rather than
  // adding another
  const saved = resolve(dirname(args.config!), `.localnet/${file}`);
  let kp: KeyPair | null = null;
  try {
    kp = KeyPair.fromString(readFileSync(saved, "utf8").trim() as KeyPairString);
    await oneup.provider.viewAccessKey({ accountId: d.keeper.id, publicKey: kp.getPublicKey().toString() });
  } catch {
    kp = null; // none saved, or not on this chain
  }
  const onChain = !!kp;
  kp ??= KeyPair.fromRandom("ed25519");
  if (!onChain) {
    const main = new Account(d.keeper.id, oneup.provider, d.keeper.key as KeyPairString);
    // no allowance: a capped key (the library's default is 0.25 NEAR) runs dry after about an hour of pushes
    await main.signAndSendTransaction({
      receiverId: d.keeper.id,
      actions: [actions.addFunctionCallAccessKey(kp.getPublicKey(), receiver, methods)],
    });
    try {
      if (existsSync(dirname(saved))) writeFileSync(saved, kp.toString(), { mode: 0o600 });
    } catch {
      // can't save: a new key next start
    }
  }
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

async function riskLoop(risk: ReturnType<OneUp["calls"]>) {
  for (;;) {
    const start = Date.now();
    try {
      await handlePositions(risk);
    } catch (e) {
      log(`positions: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
    await new Promise((r) => setTimeout(r, Math.max(0, Number(args["price-tick"]) - (Date.now() - start))));
  }
}

async function tick() {
  const steps: [string, () => Promise<void>][] = [
    ["orders", handleOrders],
    ["epoch", handleEpoch],
    ["treasury", handleTreasury],
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
void riskLoop(await riskSender());
for (;;) {
  const start = Date.now();
  await tick();
  await new Promise((r) => setTimeout(r, Math.max(0, Number(args.tick) - (Date.now() - start))));
}
