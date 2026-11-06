// Feeds the hosted app's Leaderboard, History, Activity, past jackpots, round results and Agents page on testnet.
// It follows the contracts' transactions through FastNEAR's public transaction API, runs their events through the
// same code as the local indexer (app/src/lib/server/activity.ts), and writes the results to Redis every 30 seconds.
// The app's API routes read them from there (app/src/lib/server/published.ts), so visitors never reach this machine.
//
//   ONEUP_CONFIG=/abs/.testnet/<operator>/public.json ONEUP_STATE_DIR=/abs/.testnet/<operator> \
//     KV_REST_API_URL=... KV_REST_API_TOKEN=... pnpm testnet:indexer
//
// Without KV_REST_API_URL it only reports what it would publish.

import { readFileSync } from "node:fs";
import { FailoverProvider, OneUp, rpcList, type Deployment } from "@oneup/sdk";
import {
  boardBetween,
  eventLogs,
  historyFor,
  indexedAccounts,
  indexerCursor,
  jackpotDraws,
  loadIndexerState,
  markSynced,
  recordBlock,
  recentActivity,
  saveIndexerState,
  setIndexerCursor,
  standings,
  valueSales,
} from "../app/src/lib/server/activity.ts";

const API = "https://tx.test.fastnear.com";
const TICK_MS = 30_000;
/** A transaction's receipts run over a few blocks: wait this long before reading it, so none are missed. */
const SETTLE_MS = 30_000;
const BATCH = 20;
/** Upstash limits one request's size: larger updates go in several. */
const MAX_REQUEST = 700_000;

const configFile = process.env.ONEUP_CONFIG;
if (!configFile) throw Error("Set ONEUP_CONFIG to the deployment's public.json.");
const d = JSON.parse(readFileSync(configFile, "utf8")) as Deployment;
if (d.network !== "testnet") throw Error("This indexer is for a testnet deployment.");
const c = d.contracts as unknown as Record<string, string>;
const followed = [c.house, c.market, c.life, c.ve];
const rpc = process.env.ONEUP_RPC ?? d.rpcUrl;
const oneup = new OneUp(d, new FailoverProvider(rpcList(rpc)));
const store = { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
/** A redeploy's contracts start with an empty record, under their own keys. */
const key = (name: string) => `oneup:${c.house}:${name}`;
const log = (message: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);

interface Row {
  transaction_hash: string;
  tx_block_height: number;
  tx_index: number;
  tx_block_timestamp: number;
}
interface Tx {
  transaction: { hash: string };
  receipts: { execution_outcome: { outcome: { executor_id: string; logs: string[]; status?: unknown } } }[];
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "oneup-indexer" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw Error(`${path} answered ${r.status}`);
  return (await r.json()) as T;
}

const order = (x: Row) => [x.tx_block_height, x.tx_index] as const;
const after = (x: Row, cursor: readonly [number, number] | null) =>
  !cursor || x.tx_block_height > cursor[0] || (x.tx_block_height === cursor[0] && x.tx_index > cursor[1]);

/** Every transaction touching the contracts since the cursor, oldest first. A transaction touching two appears once. */
async function newTransactions(cursor: readonly [number, number] | null): Promise<Row[]> {
  const rows = new Map<string, Row>();
  for (const account_id of followed) {
    let resume_token: string | undefined;
    for (;;) {
      const page: { account_txs: Row[]; resume_token?: string | null } = await post("/v0/account", resume_token ? { account_id, resume_token } : { account_id });
      for (const row of page.account_txs) if (after(row, cursor)) rows.set(row.transaction_hash, row);
      const older = page.account_txs.at(-1);
      if (!page.resume_token || !older || !after(older, cursor)) break;
      resume_token = page.resume_token;
    }
  }
  const settled = Date.now() - SETTLE_MS;
  return [...rows.values()]
    .sort((a, b) => a.tx_block_height - b.tx_block_height || a.tx_index - b.tx_index)
    .filter((row) => row.tx_block_timestamp / 1e6 <= settled);
}

/** Runs the transactions' events through the indexer, returning the rounds they closed. */
async function ingest(rows: Row[]): Promise<{ from: number; to: number }[]> {
  const closed: { from: number; to: number }[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { transactions } = await post<{ transactions: Tx[] }>("/v0/transactions", { tx_hashes: batch.map((r) => r.transaction_hash) });
    const byHash = new Map(transactions.map((tx) => [tx.transaction.hash, tx]));
    for (const row of batch) {
      const tx = byHash.get(row.transaction_hash);
      // not there yet: stop here, and the cursor brings it back next time
      if (!tx) return closed;
      const logs = eventLogs(tx.receipts.map((r) => r.execution_outcome.outcome), row.transaction_hash);
      for (const [executor_id, json] of logs) {
        if (executor_id !== c.house || !json.includes('"epoch_closed"')) continue;
        try {
          const { started_at, ended_at } = JSON.parse(json).data.summary ?? JSON.parse(json).data[0].summary;
          closed.push({ from: started_at * 1000, to: ended_at * 1000 });
        } catch {
          // malformed: the round simply has no results screen
        }
      }
      recordBlock({ t: Math.floor(row.tx_block_timestamp / 1e6), logs }, c);
      const [height, index] = order(row);
      setIndexerCursor(`${height}:${index}`);
    }
  }
  return closed;
}

const sent = new Map<string, string>();

/** Writes what changed, in as few requests as possible: one MSET counts as one command however many keys it holds. */
async function publish(values: Map<string, unknown>) {
  const changed: [string, string][] = [];
  for (const [name, value] of values) {
    const json = JSON.stringify(value);
    if (sent.get(name) !== json) changed.push([name, json]);
  }
  if (!changed.length) return 0;
  if (!store.url || !store.token) {
    log(`would publish ${changed.length} keys, ${changed.reduce((n, [, v]) => n + v.length, 0)} bytes (no store set)`);
    for (const [name, json] of changed) sent.set(name, json);
    return changed.length;
  }
  let request: [string, string][] = [];
  let size = 0;
  const flush = async () => {
    if (!request.length) return;
    const r = await fetch(store.url!, {
      method: "POST",
      headers: { authorization: `Bearer ${store.token}`, "content-type": "application/json" },
      body: JSON.stringify(["MSET", ...request.flatMap(([name, json]) => [key(name), json])]),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw Error(`store answered ${r.status}`);
    for (const [name, json] of request) sent.set(name, json);
    request = [];
    size = 0;
  };
  for (const entry of changed) {
    if (size + entry[1].length > MAX_REQUEST) await flush();
    request.push(entry);
    size += entry[1].length;
  }
  await flush();
  return changed.length;
}

function parseCursor(): readonly [number, number] | null {
  const m = /^(\d+):(\d+)$/.exec(indexerCursor() ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

async function tick() {
  const rows = await newTransactions(parseCursor());
  const closed = await ingest(rows);
  await valueSales();
  const now = Date.now();
  const epoch = await oneup.epoch();
  const values = new Map<string, unknown>([
    ["feed", { items: recentActivity() }],
    ["jackpots", { items: jackpotDraws() }],
    ["standings:all", standings(0, now)],
    ["standings:day", standings(now - 86_400_000, now)],
    ["standings:round", standings(epoch.started_at * 1000, now)],
  ]);
  for (const account of indexedAccounts()) values.set(`history:${account}`, historyFor(account));
  for (const { from, to } of closed) values.set(`board:${from}`, boardBetween(from, to));
  const written = await publish(values);
  saveIndexerState();
  if (rows.length || written) log(`${rows.length} new transactions, ${written} keys published, ${closed.length} rounds closed`);
}

loadIndexerState(c.house);
markSynced(1);
log(`following ${followed.join(", ")} from ${indexerCursor() ?? "the start"}; ${store.url ? "publishing" : "not publishing: no store set"}`);
for (;;) {
  const start = Date.now();
  // a failed tick loses nothing: the cursor only moves past what has been recorded
  await tick().catch((e) => log(`error: ${e instanceof Error ? e.message.slice(0, 160) : e}`));
  await new Promise((r) => setTimeout(r, Math.max(0, TICK_MS - (Date.now() - start))));
}
