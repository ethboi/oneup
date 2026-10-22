// OneUp as an MCP server: an AI agent can read the markets, open and close trades, set take-profit and
// stop-loss, see its Extra Lives and claim them, on the local chain. It signs as one account from
// localnet.json: the demo trader by default, or a bot (ONEUP_ACCOUNT=bot3). Localnet only: the keys it uses
// are the demo's throwaway ones.
//
//   pnpm mcp                                  (stdio; .mcp.json at the repo root registers it for Claude Code)
//   ONEUP_ACCOUNT=bot3 pnpm mcp

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Account, type KeyPairString } from "near-api-js";
import { z } from "zod";
import {
  PPM,
  OneUp,
  accountSender,
  fmtUsdc,
  liquidationPrice,
  maxLiability,
  normalizePrice,
  pnl,
  type Deployment,
  type Position,
  type Side,
} from "@oneup/sdk";

const d: Deployment = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../localnet.json"), "utf8"));
if (d.network !== "localnet" || !["127.0.0.1", "localhost"].includes(new URL(d.rpcUrl).hostname)) throw new Error("Localnet only");

// the account it trades as: the demo trader, or a bot by name ("bot3") or full id
const want = process.env.ONEUP_ACCOUNT ?? "demo";
const signer = [d.demo, ...d.bots].find((a) => a.id === want || a.id.split(".")[0] === want);
if (!signer) throw new Error(`ONEUP_ACCOUNT ${want} isn't the demo trader or a bot in localnet.json`);

const o = new OneUp(d);
const tx = o.calls(accountSender(new Account(signer.id, o.provider, signer.key as KeyPairString)));
const me = signer.id;

/** USDC from a number of dollars (cents kept). */
const usdc = (x: number) => BigInt(Math.round(x * 1e6));
/** A price in 1e8 units from a number. */
const toPrice = (x: number) => BigInt(Math.round(x * 1e8));
const num = (p: bigint) => Number(p) / 1e8;
const dollars = (x: bigint | string) => Number(BigInt(x)) / 1e6;

async function prices() {
  const out = new Map<string, bigint>();
  for (const m of await o.markets()) {
    const p = await o.price(m.feed_id).catch(() => null);
    const v = p && normalizePrice(BigInt(p.price), p.expo);
    if (v) out.set(m.id, v);
  }
  return out;
}

/** A position as an agent reads it: plain numbers, profit after the winner's cut if closed now. */
function describe(p: Position, mark?: bigint) {
  const margin = BigInt(p.margin);
  const raw = mark ? pnl(p.side, margin, p.leverage, BigInt(p.entry_price), mark) : null;
  const net = raw === null ? null : raw > 0n ? raw - (raw * BigInt(p.cut_ppm) + PPM - 1n) / PPM : raw;
  return {
    position_id: p.id,
    market: p.market_id,
    side: p.side,
    margin_usd: dollars(margin),
    leverage: p.leverage,
    size_usd: dollars(margin * BigInt(p.leverage)),
    entry_price: num(BigInt(p.entry_price)),
    mark_price: mark ? num(mark) : null,
    liquidation_price: num(liquidationPrice(p.side, BigInt(p.entry_price), p.leverage)),
    pnl_usd_if_closed_now: net === null ? null : dollars(net),
    take_profit: p.triggers.take_profit ? num(BigInt(p.triggers.take_profit)) : null,
    stop_loss: p.triggers.stop_loss ? num(BigInt(p.triggers.stop_loss)) : null,
    closing: p.close_order !== null,
    can_close_from: new Date((p.opened_at + 60) * 1000).toISOString(),
  };
}

const json = (x: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) }] });
const fail = (e: unknown) => {
  const msg = (e instanceof Error ? e.message : String(e)).match(/panicked: ([^"\n]+)/)?.[1] ?? String(e).slice(0, 300);
  return { content: [{ type: "text" as const, text: `Failed: ${msg}` }], isError: true };
};
const safe =
  <A>(f: (a: A) => Promise<unknown>) =>
  async (a: A) => {
    try {
      return json(await f(a));
    } catch (e) {
      return fail(e);
    }
  };

const server = new McpServer({ name: "oneup", version: "0.1.0" });

server.registerTool(
  "how_it_works",
  { title: "How OneUp works", description: "The rules in a few lines: read this first.", inputSchema: {} },
  safe(async () => ({
    account: me,
    rules: [
      "Perpetuals against one USDC house pool, at the oracle price, no fees or funding. Leverage up to 1000x.",
      "An order fills at the first oracle price after it's placed (a few seconds). A position must be held 60 s before it can close.",
      "A trade can win at most 9x its margin. Winners pay a cut of their profit (10%, up to 25% for big positions).",
      "At a 90% loss the position is liquidated: a move of 90/leverage % against you.",
      "Losing a trade earns an Extra Life (an NFT paying USDC back from house profit, up to 1.2-2x the loss) and $1UP locked for 2 years, when the round ends.",
      "The house refuses trades it couldn't pay in full, so a refusal means the market is full: try smaller.",
    ],
  })),
);

server.registerTool(
  "markets",
  { title: "Markets", description: "Every market: price, max leverage, how its open exposure splits between longs and shorts, and room left.", inputSchema: {} },
  safe(async () => {
    const [ms, px, s] = await Promise.all([o.markets(), prices(), o.solvency()]);
    return ms.map((m) => {
      const long = BigInt(m.long_liability);
      const short = BigInt(m.short_liability);
      const sm = s.markets.find((x) => x.id === m.id);
      return {
        market: m.id,
        price: px.get(m.id) ? num(px.get(m.id)!) : null,
        max_leverage: m.max_leverage,
        open: m.live,
        longs_pct: long + short > 0n ? Number((long * 1000n) / (long + short)) / 10 : null,
        room_usd: sm ? dollars(BigInt(sm.capacity) - BigInt(sm.liability)) : null,
      };
    });
  }),
);

server.registerTool(
  "account",
  {
    title: "Account",
    description: "This agent's account: wallet USDC, free balance at the house, open positions with live profit, pending orders, and this round's pending Extra Life.",
    inputSchema: {},
  },
  safe(async () => {
    const [wallet, free, positions, orders, pending, epoch, px] = await Promise.all([
      o.usdcBalance(me),
      o.balance(me),
      o.positions(me),
      o.orders(me),
      o.pendingLife(me),
      o.epoch(),
      prices(),
    ]);
    return {
      account: me,
      wallet_usd: dollars(wallet),
      free_at_house_usd: dollars(free),
      positions: positions.map((p) => describe(p, px.get(p.market_id))),
      pending_orders: orders.map((x) => ({ order_id: x.id, market: x.market_id, kind: "Open" in x.kind ? "open" : "close" })),
      round: { id: epoch.id, ends: new Date((epoch.started_at + d.epochLengthS) * 1000).toISOString() },
      net_loss_this_round_usd: dollars(pending),
    };
  }),
);

const tradeArgs = {
  market: z.string().describe('Market id, e.g. "BTC-USD"'),
  side: z.enum(["Long", "Short"]),
  margin_usd: z.number().positive().describe("Margin in USDC"),
  leverage: z.number().int().min(1).max(100),
};

server.registerTool(
  "quote_trade",
  { title: "Quote a trade", description: "Whether the house would take a trade, its winner's cut, max win and liquidation price. Places nothing.", inputSchema: tradeArgs },
  safe(async ({ market, side, margin_usd, leverage }) => {
    const margin = usdc(margin_usd);
    const [q, px] = await Promise.all([o.quoteOpen(market, side as Side, margin, leverage), prices()]);
    // the quote leaves the liquidation price out when no price is given: work it out from the price now
    const liq = q.liquidation_price ? BigInt(q.liquidation_price) : px.get(market) ? liquidationPrice(side as Side, px.get(market)!, leverage) : null;
    return {
      allowed: q.allowed,
      reason: q.reason,
      winners_cut_pct: Number(q.cut_ppm) / 1e4,
      max_win_usd: dollars(maxLiability(margin)),
      price_now: px.get(market) ? num(px.get(market)!) : null,
      liquidation_price: liq ? num(liq) : null,
      liquidates_on_move_pct: 90 / leverage,
    };
  }),
);

server.registerTool(
  "open_trade",
  {
    title: "Open a trade",
    description:
      "Places an order to open a position; it fills at the next oracle price (check `account` a few seconds later). Takes margin from the free balance at the house, depositing from the wallet if needed. Optional take-profit and stop-loss are prices.",
    inputSchema: { ...tradeArgs, take_profit: z.number().positive().optional(), stop_loss: z.number().positive().optional() },
  },
  safe(async ({ market, side, margin_usd, leverage, take_profit, stop_loss }) => {
    const margin = usdc(margin_usd);
    const q = await o.quoteOpen(market, side as Side, margin, leverage);
    if (!q.allowed) throw new Error(q.reason ?? "The house won't take this trade");
    const triggers = { takeProfit: take_profit ? toPrice(take_profit) : null, stopLoss: stop_loss ? toPrice(stop_loss) : null };
    const free = BigInt(await o.balance(me));
    const topUp = margin > free ? margin - free : 0n;
    if (topUp > 0n) {
      if (topUp > BigInt(await o.usdcBalance(me))) throw new Error(`Needs $${fmtUsdc(topUp)} more USDC in the wallet (try faucet)`);
      await tx.depositAndOpen(topUp, market, side as Side, margin, leverage, triggers);
      return { placed: true, deposited_usd: dollars(topUp), note: "Fills at the next oracle price; see `account`." };
    }
    const order = await tx.placeOpen(market, side as Side, margin, leverage, triggers);
    return { placed: true, order_id: order, note: "Fills at the next oracle price; see `account`." };
  }),
);

server.registerTool(
  "close_trade",
  { title: "Close a trade", description: "Places a close for a position; it settles at the next oracle price. Positions must be held 60 s first.", inputSchema: { position_id: z.number().int() } },
  safe(async ({ position_id }) => ({ placed: true, order_id: await tx.placeClose(position_id), note: "Settles at the next oracle price." })),
);

server.registerTool(
  "set_triggers",
  {
    title: "Set take-profit and stop-loss",
    description: "Sets a position's take-profit and stop-loss prices. Omit one to clear it.",
    inputSchema: { position_id: z.number().int(), take_profit: z.number().positive().optional(), stop_loss: z.number().positive().optional() },
  },
  safe(async ({ position_id, take_profit, stop_loss }) => {
    await tx.setTriggers(position_id, { takeProfit: take_profit ? toPrice(take_profit) : null, stopLoss: stop_loss ? toPrice(stop_loss) : null });
    return { set: true, take_profit: take_profit ?? null, stop_loss: stop_loss ?? null };
  }),
);

server.registerTool(
  "extra_lives",
  { title: "Extra Lives", description: "This account's Extra Lives: what each is owed, has been paid and can be claimed now.", inputSchema: {} },
  safe(async () =>
    (await o.lives(me)).map((l) => ({
      token_id: l.token_id,
      backer: l.backer,
      owed_usd: dollars(l.owed),
      paid_usd: dollars(l.paid),
      claimable_usd: dollars(l.claimable),
      state: l.full_heal ? "paid in full" : l.expired ? "expired" : "earning",
    })),
  ),
);

server.registerTool(
  "claim_lives",
  { title: "Claim Extra Lives", description: "Sends the USDC every Extra Life of this account can claim to its wallet.", inputSchema: {} },
  safe(async () => {
    const ready = (await o.lives(me)).filter((l) => BigInt(l.claimable) > 0n);
    if (ready.length === 0) return { claimed_usd: 0 };
    await tx.claimLives(ready.map((l) => l.token_id));
    return { claimed_usd: ready.reduce((s, l) => s + dollars(l.claimable), 0), lives: ready.length };
  }),
);

server.registerTool(
  "house",
  { title: "The house", description: "The pool, what it would owe if every position hit its max win, the round and how the house is doing in it.", inputSchema: {} },
  safe(async () => {
    const [s, e] = await Promise.all([o.solvency(), o.epoch()]);
    return {
      pool_usd: dollars(s.pool),
      worst_case_payout_usd: dollars(s.liability),
      round: e.id,
      round_ends: new Date((e.started_at + d.epochLengthS) * 1000).toISOString(),
      house_this_round_usd: dollars(BigInt(e.losses) - BigInt(e.payouts)),
    };
  }),
);

server.registerTool(
  "faucet",
  { title: "Test USDC", description: "Mints test USDC to this account's wallet (local chain only).", inputSchema: { amount_usd: z.number().positive().max(100_000) } },
  safe(async ({ amount_usd }) => {
    await tx.faucet(usdc(amount_usd));
    return { wallet_usd: dollars(await o.usdcBalance(me)) };
  }),
);

await server.connect(new StdioServerTransport());
console.error(`oneup MCP server on ${d.rpcUrl}, trading as ${me}`);
