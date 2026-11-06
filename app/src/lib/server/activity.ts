// A small server-side indexer for the activity feed and each account's history. It follows the local chain
// a few blocks behind the head (so cross-contract calls have finished), reads each transaction's receipts and
// keeps the OneUp events (NEP-297 logs). On first start it scans from block 1, so history is complete; the
// keeper's price pushes (most transactions) are skipped without being read. Localnet only: it reads the RPC
// from localnet.json. What it has read is saved to .localnet/indexer.json (wiped with the chain by
// `pnpm localnet:reset`), so an app restart carries on rather than relying on the node still having old blocks.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { configPath, stateDir } from "./localnet";
import { ONEUP, OneUp, displayAccount, netTradePnl } from "@oneup/sdk";
export { netTradePnl } from "@oneup/sdk";

export interface ActivityItem {
  seq: number;
  /** ms since epoch, from the block. */
  t: number;
  kind: "liquidated" | "lost" | "won" | "opened" | "life" | "lock" | "epoch" | "sold" | "backed" | "jackpot";
  /** Short account names: "bot3", "demo". */
  who?: string;
  text: string;
  /** On a sale: what changed hands and its price; `value` is what it was worth then (USDC 1e6), when the sale
   *  was seen live (an old sale found by a rescan can't be valued after the fact). */
  sale?: { nft: "life" | "lock"; token_id: string; price: string; value?: string };
  /** On a jackpot win: what it paid. */
  amount?: string;
  /** On a jackpot draw: its round and the winner's tickets out of all of them (none when it rolled over). */
  draw?: { epoch: number; tickets?: string; total?: string };
  /** On an open or a close: the trade, for the trades tape (size and price in USDC 1e6 and price 1e8 units). A
   *  close only carries it when its open was seen. */
  trade?: { market: string; side: "Long" | "Short"; size: string; price: string; open: boolean };
  /** The transaction the event came from, for an explorer link. */
  tx?: string;
}

/** One closed trade: its open and close events joined by position id. */
export interface TradeRecord {
  position_id: number;
  market_id: string;
  side: "Long" | "Short";
  leverage: number;
  /** USDC, 6 decimals. */
  margin: string;
  /** 1e8 units. */
  entry_price: string;
  exit_price: string;
  /** Signed USDC, 6 decimals, before the winner's cut. */
  pnl: string;
  /** The winner's cut, USDC 6 decimals (0 on a loss; missing on records indexed before it was kept). */
  cut?: string;
  reason: "Close" | "Liquidation" | "TakeProfit" | "Target" | "Stop";
  opened_t: number;
  closed_t: number;
}

export type HistoryItem = HistoryEntry & { seq: number };
/** `tx`: the transaction the event came from, for an explorer link. */
type HistoryEntry = { t: number; tx?: string } & (
  | { kind: "trade"; trade: TradeRecord }
  | { kind: "deposit" | "withdraw" | "claim_usdc"; amount: string }
  | { kind: "backed"; amount: string; cap_ppm: string }
  | { kind: "jackpot"; amount: string; tickets: string }
  | { kind: "claim_oneup"; amount: string }
  | { kind: "life" | "lock"; token_id: string }
  | { kind: "bought" | "sold"; what: "Extra Life" | "$1UP lock"; price: string; other: string }
);

interface Opened {
  market_id: string;
  side: "Long" | "Short";
  leverage: number;
  margin: string;
  entry_price: string;
  t: number;
}

interface State {
  genesis: string;
  dirty: boolean;
  next: number | null;
  head: number;
  items: ActivityItem[];
  seq: number;
  running: boolean;
  history: Map<string, HistoryItem[]>;
  opened: Map<number, Opened>;
  /** Testnet: the last transaction read, "<block height>:<index>" (scripts/testnet-indexer.ts). */
  cursor: string | null;
}

/** Blocks behind the head before a block is read, so the receipts it started have run. */
const LAG = 4;
const KEEP = 200;
const KEEP_PER_ACCOUNT = 1000;
/** Blocks read at once while catching up. */
const BATCH = 25;
const short = displayAccount;
const usd = (raw: string | number) => {
  const v = Number(raw) / 1e6;
  const d = v >= 1000 ? 0 : 2;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};

const g = globalThis as unknown as { __oneupActivity2?: State };
const state: State = (g.__oneupActivity2 ??= {
  genesis: "",
  dirty: false,
  next: null,
  head: 0,
  items: [],
  seq: 0,
  running: false,
  history: new Map(),
  opened: new Map(),
  cursor: null,
});

const SAVE = resolve(stateDir(), "indexer.json");

function load(genesis: string) {
  state.genesis = genesis;
  if (!existsSync(SAVE)) return;
  try {
    const j = JSON.parse(readFileSync(SAVE, "utf8"));
    if (j.genesis !== genesis) return; // a different chain
    Object.assign(state, { next: j.next, items: j.items, seq: j.seq, history: new Map(j.history), opened: new Map(j.opened), cursor: j.cursor ?? null });
  } catch {
    // unreadable: rescan
  }
}

function save() {
  if (!state.dirty) return;
  state.dirty = false;
  const { genesis, next, items, seq, cursor } = state;
  writeFileSync(SAVE, JSON.stringify({ genesis, next, items, seq, cursor, history: [...state.history], opened: [...state.opened] }));
}

function config() {
  const d = JSON.parse(readFileSync(configPath(), "utf8"));
  return { rpc: d.rpcUrl as string, c: d.contracts as Record<string, string> };
}

class RpcError extends Error {
  constructor(readonly detail: { cause?: { name?: string }; data?: { name?: string } }) {
    super(JSON.stringify(detail).slice(0, 200));
  }
}

async function rpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new RpcError(j.error);
  return j.result as T;
}

interface Event {
  standard: string;
  event: string;
  data: Record<string, unknown>[] | Record<string, unknown>;
}

export type Out = { feed: Omit<ActivityItem, "seq">[]; history: [string, HistoryEntry][] };

/** Whether an event comes from the contract that owns its standard: anyone can deploy a contract that logs
 *  `oneup` events, so only the house's count (and the market's `oneup_market` ones). */
export function trusted(ev: Pick<Event, "standard">, executor: string, c: Record<string, string>): boolean {
  if (ev.standard === "oneup") return executor === c.house;
  if (ev.standard === "oneup_market") return executor === c.market;
  return true; // nep171/nep141: each branch below checks its executor
}

export function toItems(ev: Event, executor: string, t: number, c: Record<string, string>, out: Out) {
  if (!trusted(ev, executor, c)) return;
  const rows = Array.isArray(ev.data) ? ev.data : [ev.data];
  const mine = (account: string, item: HistoryEntry) => out.history.push([account, item]);
  for (const d of rows) {
    if (ev.standard === "oneup" && ev.event === "position_closed") {
      const account = String(d.account_id);
      const who = short(account);
      const pnl = Number(d.pnl);
      if (d.reason === "Liquidation") out.feed.push({ t, kind: "liquidated", who, text: `${who} was liquidated on ${d.market_id}` });
      else if (pnl < 0) out.feed.push({ t, kind: "lost", who, text: `${who} lost ${usd(-pnl)} on ${d.market_id}` });
      else out.feed.push({ t, kind: "won", who, text: `${who} won ${usd(pnl)} on ${d.market_id}` });
      const id = Number(d.position_id);
      const o = state.opened.get(id);
      state.opened.delete(id);
      const last = out.feed[out.feed.length - 1];
      if (o) last.trade = { market: o.market_id, side: o.side, size: String(BigInt(o.margin) * BigInt(o.leverage)), price: String(d.price), open: false };
      if (o) {
        mine(account, {
          t,
          kind: "trade",
          trade: {
            position_id: id,
            market_id: o.market_id,
            side: o.side,
            leverage: o.leverage,
            margin: o.margin,
            entry_price: o.entry_price,
            exit_price: String(d.price),
            pnl: String(d.pnl),
            cut: String(d.cut ?? 0),
            reason: d.reason as TradeRecord["reason"],
            opened_t: o.t,
            closed_t: t,
          },
        });
      }
    } else if (ev.standard === "oneup" && ev.event === "position_opened") {
      const who = short(String(d.account_id));
      const side = String(d.side) as Opened["side"];
      state.opened.set(Number(d.position_id), {
        market_id: String(d.market_id),
        side,
        leverage: Number(d.leverage),
        margin: String(d.margin),
        entry_price: String(d.entry_price),
        t,
      });
      out.feed.push({
        t,
        kind: "opened",
        who,
        text: `${who} opened a ${d.leverage}× ${side.toLowerCase()} on ${d.market_id}`,
        trade: { market: String(d.market_id), side, size: String(BigInt(String(d.margin)) * BigInt(Number(d.leverage))), price: String(d.entry_price), open: true },
      });
    } else if (ev.standard === "oneup" && (ev.event === "deposit" || ev.event === "withdraw")) {
      mine(String(d.account_id), { t, kind: ev.event, amount: String(d.amount) });
    } else if (ev.standard === "oneup" && ev.event === "backed") {
      const who = short(String(d.account_id));
      mine(String(d.account_id), { t, kind: "backed", amount: String(d.amount), cap_ppm: String(d.cap_ppm) });
      out.feed.push({ t, kind: "backed", who, text: `${who} backed the house with ${usd(String(d.amount))}` });
    } else if (ev.standard === "oneup" && ev.event === "jackpot_won") {
      const who = short(String(d.account_id));
      mine(String(d.account_id), { t, kind: "jackpot", amount: String(d.amount), tickets: String(d.tickets) });
      out.feed.push({
        t,
        kind: "jackpot",
        who,
        text: `${who} won the ${usd(String(d.amount))} jackpot`,
        amount: String(d.amount),
        draw: { epoch: Number(d.epoch), tickets: String(d.tickets), total: String(d.total_tickets) },
      });
    } else if (ev.standard === "oneup" && ev.event === "jackpot_rolled") {
      // a draw with no tickets in it: the pot carries on to the next one
      out.feed.push({ t, kind: "jackpot", text: `Round ${d.epoch}'s jackpot draw had no tickets; ${usd(String(d.jackpot))} rolls over`, amount: String(d.jackpot), draw: { epoch: Number(d.epoch) } });
    } else if (ev.standard === "oneup" && ev.event === "epoch_closed") {
      const s = d.summary as Record<string, string | number>;
      const lives = Number(s.lives_minted);
      out.feed.push({
        t,
        kind: "epoch",
        text: lives
          ? `Round ${s.epoch} closed: ${lives} Extra Lives, ${usd(s.lives_pot)} paid to lives`
          : `Round ${s.epoch} closed: the house didn't profit, no Extra Lives`,
      });
    } else if (ev.standard === "nep171" && ev.event === "nft_mint" && executor === c.life) {
      const owner = String(d.owner_id);
      const token = String((d.token_ids as string[])[0]);
      if (token.startsWith("0:")) continue; // the seed's life
      out.feed.push({ t, kind: "life", who: short(owner), text: `${short(owner)} got an Extra Life` });
      mine(owner, { t, kind: "life", token_id: token });
    } else if (ev.standard === "nep171" && ev.event === "nft_mint" && executor === c.ve) {
      const owner = String(d.owner_id);
      out.feed.push({ t, kind: "lock", who: short(owner), text: `${short(owner)} got a $1UP lock` });
      mine(owner, { t, kind: "lock", token_id: String((d.token_ids as string[])[0]) });
    } else if (ev.standard === "oneup_market" && ev.event === "sold") {
      const what = d.nft_contract === c.life ? "Extra Life" : "$1UP lock";
      const buyer = String(d.buyer);
      const seller = String(d.seller);
      out.feed.push({
        t,
        kind: "sold",
        who: short(buyer),
        text: `${short(buyer)} bought ${short(seller)}'s ${what} for ${usd(String(d.price))}`,
        sale: { nft: d.nft_contract === c.life ? "life" : "lock", token_id: String(d.token_id), price: String(d.price) },
      });
      mine(buyer, { t, kind: "bought", what, price: String(d.price), other: seller });
      mine(seller, { t, kind: "sold", what, price: String(d.price), other: buyer });
    } else if (ev.standard === "nep141" && ev.event === "ft_transfer") {
      // payouts from the life and lock contracts are claims (a lock's unlock or early exit counts too)
      if (executor === c.usdc && d.old_owner_id === c.life) mine(String(d.new_owner_id), { t, kind: "claim_usdc", amount: String(d.amount) });
      if (executor === c.oneup && d.old_owner_id === c.ve) mine(String(d.new_owner_id), { t, kind: "claim_oneup", amount: String(d.amount) });
    }
  }
}

/** The events in a transaction's receipts. A failed receipt's logs are skipped: its state changes rolled back, so
 *  what it logged didn't happen. */
export function eventLogs(outcomes: { logs: string[]; executor_id: string; status?: unknown }[], tx: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const outcome of outcomes) {
    if (outcome.status && typeof outcome.status === "object" && "Failure" in outcome.status) continue;
    for (const log of outcome.logs) if (log.startsWith("EVENT_JSON:")) out.push([outcome.executor_id, log.slice(11), tx]);
  }
  return out;
}

/** Reads one block's OneUp events, without recording them (blocks are read in parallel, recorded in order). */
async function readBlock(url: string, height: number, c: Record<string, string>): Promise<{ t: number; logs: [string, string, string][] } | null> {
  const block = await rpc<{ header: { timestamp_nanosec: string }; chunks: { chunk_hash: string; tx_root: string }[] }>(url, "block", { block_id: height }).catch((error: unknown) => {
    // Only a definitive missing final block is a skipped height; transport and other RPC errors retry.
    if (error instanceof RpcError && (error.detail.cause?.name === "UNKNOWN_BLOCK" || error.detail.data?.name === "UNKNOWN_BLOCK")) return null;
    throw error;
  });
  if (!block) return null;
  const t = Math.floor(Number(block.header.timestamp_nanosec) / 1e6);
  const logs: [string, string, string][] = [];
  for (const ch of block.chunks) {
    if (ch.tx_root === "11111111111111111111111111111111") continue; // no transactions
    const chunk = await rpc<{ transactions: { hash: string; signer_id: string; receiver_id: string }[] }>(url, "chunk", { chunk_id: ch.chunk_hash });
    for (const tx of chunk.transactions) {
      if (tx.receiver_id === c.oracle) continue; // price pushes: no events
      const res = await rpc<{ receipts_outcome: { outcome: { logs: string[]; executor_id: string; status?: unknown } }[] }>(url, "EXPERIMENTAL_tx_status", {
        tx_hash: tx.hash,
        sender_account_id: tx.signer_id,
        wait_until: "FINAL",
      });
      logs.push(...eventLogs((res?.receipts_outcome ?? []).map((r) => r.outcome), tx.hash));
    }
  }
  return { t, logs };
}

function record(block: { t: number; logs: [string, string, string][] }, c: Record<string, string>) {
  const out: Out = { feed: [], history: [] };
  for (const [executor, json, tx] of block.logs) {
    const [f, h] = [out.feed.length, out.history.length];
    try {
      toItems(JSON.parse(json), executor, block.t, c, out);
    } catch {
      // not ours or malformed
    }
    // what this event added carries its transaction
    for (const item of out.feed.slice(f)) item.tx = tx;
    for (const [, item] of out.history.slice(h)) item.tx = tx;
  }
  for (const item of out.feed) {
    // a live sale waits for its valuation (valueSales), so it reaches the feed with it
    if (item.sale && Date.now() - item.t < 120_000) pendingSales.push(item);
    else state.items.push({ ...item, seq: ++state.seq });
  }
  for (const [account, item] of out.history) {
    const list = state.history.get(account) ?? [];
    list.push({ ...item, seq: ++state.seq } as HistoryItem);
    if (list.length > KEEP_PER_ACCOUNT) list.splice(0, list.length - KEEP_PER_ACCOUNT);
    state.history.set(account, list);
  }
  if (state.items.length > KEEP) {
    // the feed keeps its newest KEEP items, but every jackpot draw stays for the winners' history
    const cut = state.items.length - KEEP;
    state.items = state.items.filter((i, k) => k >= cut || (i.kind === "jackpot" && i.draw));
  }
}

const pendingSales: Omit<ActivityItem, "seq">[] = [];

/** What a sold life or lock was worth as it sold: a life's USDC still to pay, a lock's $1UP if left today at
 *  the swap price. The NFT has just moved, so its state is the state at the sale. */
export async function valueSales() {
  if (pendingSales.length === 0) return;
  const o = new OneUp(JSON.parse(readFileSync(configPath(), "utf8")));
  for (const item of pendingSales.splice(0)) {
    const sale = item.sale!;
    try {
      if (sale.nft === "life") {
        const l = await o.lifeInfo(sale.token_id);
        if (l) sale.value = String(l.expired || l.full_heal ? BigInt(l.claimable) : BigInt(l.owed) - BigInt(l.paid) + BigInt(l.claimable));
      } else {
        const [l, out] = await Promise.all([o.lockInfo(sale.token_id), o.swapQuote(100_000_000n)]);
        if (l && !l.withdrawn && BigInt(out) > 0n) {
          const px = (100_000_000n * ONEUP) / BigInt(out); // USDC per whole $1UP
          sale.value = String(((BigInt(l.amount) - BigInt(l.exit_penalty)) * px) / ONEUP);
        }
      }
    } catch {
      // unvalued: the sale still shows
    }
    state.items.push({ ...item, seq: ++state.seq });
    state.dirty = true;
  }
}

/** Read the entire batch successfully before committing any events or advancing the cursor. */
export async function indexBatch(url: string, heights: number[], c: Record<string, string>) {
  if (heights.length === 0) return;
  const blocks = await Promise.all(heights.map((h) => readBlock(url, h, c)));
  for (const b of blocks) if (b) record(b, c);
  state.next = heights[heights.length - 1] + 1;
  state.dirty = true;
  await valueSales();
}

async function step() {
  const { rpc: url, c } = config();
  if (!state.genesis) load((await rpc<{ genesis_hash: string }>(url, "status", [])).genesis_hash);
  const head = await rpc<{ header: { height: number } }>(url, "block", { finality: "final" });
  const target = head.header.height - LAG;
  state.head = target;
  state.next ??= 1;
  // catch up in parallel batches, recorded in block order; a missing height (skipped block) is passed over
  for (let n = 0; state.next <= target && n < 20; n++) {
    const heights = Array.from({ length: Math.min(BATCH, target - state.next + 1) }, (_, i) => state.next! + i);
    await indexBatch(url, heights, c);
  }
}

/** For scripts/testnet-indexer.ts, which reads transactions from elsewhere rather than scanning blocks. */
export const loadIndexerState = (id: string) => load(id);
export const saveIndexerState = () => save();
export const indexerCursor = () => state.cursor;
export const indexedAccounts = () => [...state.history.keys()];
export const recentActivity = () => state.items;
export function setIndexerCursor(cursor: string) {
  state.cursor = cursor;
  state.dirty = true;
}
export function recordBlock(block: { t: number; logs: [string, string, string][] }, c: Record<string, string>) {
  record(block, c);
  state.dirty = true;
}
/** The testnet indexer is always current with the chain, bar its short delay. */
export function markSynced(head: number) {
  state.head = head;
  state.next = head + 1;
}

export function startActivity() {
  if (state.running) return;
  state.running = true;
  const loop = async () => {
    await step().catch(() => {});
    setTimeout(loop, 1000);
  };
  void loop();
  setInterval(() => {
    try {
      save();
    } catch {
      // disk trouble: keep going in memory
    }
  }, 10_000);
}

export function activitySince(after: number): ActivityItem[] {
  return state.items.filter((i) => i.seq > after);
}

/** Every jackpot draw seen, newest first: winners, and the ones that rolled over. */
export function jackpotDraws(): ActivityItem[] {
  return state.items.filter((i) => i.kind === "jackpot" && i.draw).reverse();
}

/** An account's history, newest first, and how far the scan has got (it starts from block 1). */
export function historyFor(account: string): { items: HistoryItem[]; synced: boolean; progress: number } {
  const done = (state.next ?? 1) - 1;
  return {
    items: [...(state.history.get(account) ?? [])].reverse(),
    synced: state.head > 0 && done >= state.head - 10,
    progress: state.head > 0 ? Math.min(1, done / state.head) : 0,
  };
}

export interface BoardRow {
  account: string;
  pnl: string;
  trades: number;
}

export interface Board {
  /** By total PnL in the window, best first. */
  top: BoardRow[];
  /** The best single trade by return on margin. */
  best: (TradeRecord & { account: string }) | null;
  /** The biggest single loss: the biggest Extra Life on its way. */
  biggestLoss: (TradeRecord & { account: string }) | null;
  synced: boolean;
}

/** A leaderboard of trades closed in [from, to] (ms), across every account. */
/** One trader's results over a period, for the leaderboard: profit after the winner's cut. */
export interface Standing {
  account: string;
  pnl: string;
  trades: number;
  wins: number;
  /** Σ margin × leverage, USDC. */
  volume: string;
  liquidations: number;
}

/** Every trader's results between `from` and `to` (ms), best first. */
export function standings(from: number, to: number): { rows: Standing[]; synced: boolean } {
  const rows: Standing[] = [];
  for (const [account, items] of state.history) {
    let pnl = 0n;
    let volume = 0n;
    let trades = 0;
    let wins = 0;
    let liquidations = 0;
    for (const i of items) {
      if (i.kind !== "trade" || i.t < from || i.t > to) continue;
      const t = i.trade;
      pnl += netTradePnl(t);
      volume += BigInt(t.margin) * BigInt(t.leverage);
      trades++;
      if (BigInt(t.pnl) > 0n) wins++;
      if (t.reason === "Liquidation") liquidations++;
    }
    if (trades) rows.push({ account, pnl: pnl.toString(), trades, wins, volume: volume.toString(), liquidations });
  }
  rows.sort((a, b) => (BigInt(b.pnl) > BigInt(a.pnl) ? 1 : BigInt(b.pnl) < BigInt(a.pnl) ? -1 : 0));
  const done = (state.next ?? 1) - 1;
  return { rows, synced: state.head > 0 && done >= state.head - 10 };
}

export function boardBetween(from: number, to: number): Board {
  const sums = new Map<string, { pnl: bigint; trades: number }>();
  let best: Board["best"] = null;
  let worst: Board["biggestLoss"] = null;
  const roe = (t: TradeRecord) => Number(netTradePnl(t)) / Math.max(1, Number(t.margin));
  for (const [account, items] of state.history) {
    for (const i of items) {
      if (i.kind !== "trade" || i.t < from || i.t > to) continue;
      const s = sums.get(account) ?? { pnl: 0n, trades: 0 };
      s.pnl += netTradePnl(i.trade);
      s.trades++;
      sums.set(account, s);
      if (!best || roe(i.trade) > roe(best)) best = { ...i.trade, account };
      if (!worst || BigInt(i.trade.pnl) < BigInt(worst.pnl)) worst = { ...i.trade, account };
    }
  }
  const top = [...sums]
    .sort((a, b) => (b[1].pnl > a[1].pnl ? 1 : b[1].pnl < a[1].pnl ? -1 : 0))
    .slice(0, 5)
    .map(([account, s]) => ({ account, pnl: s.pnl.toString(), trades: s.trades }));
  const done = (state.next ?? 1) - 1;
  return { top, best, biggestLoss: worst && BigInt(worst.pnl) < 0n ? worst : null, synced: state.head > 0 && done >= state.head - 10 };
}
