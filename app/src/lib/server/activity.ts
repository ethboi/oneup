// A small server-side indexer for the activity feed. It follows the local chain a few blocks behind the
// head (so cross-contract calls have finished), reads each transaction's receipts and keeps the OneUp
// events (NEP-297 logs) as plain feed items. Localnet only: it reads the RPC from localnet.json.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ActivityItem {
  seq: number;
  /** ms since epoch, from the block. */
  t: number;
  kind: "liquidated" | "lost" | "won" | "opened" | "life" | "lock" | "epoch" | "sold";
  /** Short account names: "bot3", "demo". */
  who?: string;
  text: string;
}

interface State {
  next: number | null;
  items: ActivityItem[];
  seq: number;
  running: boolean;
}

/** Blocks behind the head before a block is read, so the receipts it started have run. */
const LAG = 4;
const KEEP = 200;
const short = (a: string) => a.replace(/\.test\.near$/, "");
const usd = (raw: string | number) => {
  const v = Number(raw) / 1e6;
  const d = v >= 1000 ? 0 : 2;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};

const g = globalThis as unknown as { __oneupActivity?: State };
const state: State = (g.__oneupActivity ??= { next: null, items: [], seq: 0, running: false });

function config() {
  const d = JSON.parse(readFileSync(resolve(process.cwd(), "../localnet.json"), "utf8"));
  return { rpc: d.rpcUrl as string, c: d.contracts as Record<string, string> };
}

async function rpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j.result as T;
}

interface Event {
  standard: string;
  event: string;
  data: Record<string, unknown>[] | Record<string, unknown>;
}

function toItems(ev: Event, executor: string, t: number, c: Record<string, string>): Omit<ActivityItem, "seq">[] {
  const rows = Array.isArray(ev.data) ? ev.data : [ev.data];
  const out: Omit<ActivityItem, "seq">[] = [];
  for (const d of rows) {
    if (ev.standard === "oneup" && ev.event === "position_closed") {
      const who = short(String(d.account_id));
      const pnl = Number(d.pnl);
      if (d.reason === "Liquidation") out.push({ t, kind: "liquidated", who, text: `${who} was liquidated on ${d.market_id}` });
      else if (pnl < 0) out.push({ t, kind: "lost", who, text: `${who} lost ${usd(-pnl)} on ${d.market_id}` });
      else out.push({ t, kind: "won", who, text: `${who} won ${usd(pnl)} on ${d.market_id}` });
    } else if (ev.standard === "oneup" && ev.event === "position_opened") {
      const who = short(String(d.account_id));
      const side = String(d.side).toLowerCase();
      out.push({ t, kind: "opened", who, text: `${who} opened a ${d.leverage}× ${side} on ${d.market_id}` });
    } else if (ev.standard === "oneup" && ev.event === "epoch_closed") {
      const s = d.summary as Record<string, string | number>;
      const lives = Number(s.lives_minted);
      out.push({
        t,
        kind: "epoch",
        text: lives
          ? `Epoch ${s.epoch} closed: ${lives} Extra Lives, ${usd(s.lives_pot)} paid to lives`
          : `Epoch ${s.epoch} closed: the house didn't profit, no Extra Lives`,
      });
    } else if (ev.standard === "nep171" && ev.event === "nft_mint" && executor === c.life) {
      const who = short(String(d.owner_id));
      if (String((d.token_ids as string[])[0]).startsWith("0:")) continue; // the seed's life
      out.push({ t, kind: "life", who, text: `${who} got an Extra Life` });
    } else if (ev.standard === "nep171" && ev.event === "nft_mint" && executor === c.ve) {
      const who = short(String(d.owner_id));
      out.push({ t, kind: "lock", who, text: `${who} got a $1UP lock` });
    } else if (ev.standard === "oneup_market" && ev.event === "sold") {
      const what = d.nft_contract === c.life ? "Extra Life" : "$1UP lock";
      out.push({ t, kind: "sold", who: short(String(d.buyer)), text: `${short(String(d.buyer))} bought ${short(String(d.seller))}'s ${what} for ${usd(String(d.price))}` });
    }
  }
  return out;
}

async function readBlock(url: string, height: number, c: Record<string, string>) {
  const block = await rpc<{ header: { timestamp_nanosec: string }; chunks: { chunk_hash: string; tx_root: string }[] }>(url, "block", { block_id: height });
  const t = Math.floor(Number(block.header.timestamp_nanosec) / 1e6);
  for (const ch of block.chunks) {
    if (ch.tx_root === "11111111111111111111111111111111") continue; // no transactions
    const chunk = await rpc<{ transactions: { hash: string; signer_id: string }[] }>(url, "chunk", { chunk_id: ch.chunk_hash });
    for (const tx of chunk.transactions) {
      const res = await rpc<{ receipts_outcome: { outcome: { logs: string[]; executor_id: string } }[] }>(url, "EXPERIMENTAL_tx_status", {
        tx_hash: tx.hash,
        sender_account_id: tx.signer_id,
        wait_until: "NONE",
      }).catch(() => null);
      for (const r of res?.receipts_outcome ?? []) {
        for (const log of r.outcome.logs) {
          if (!log.startsWith("EVENT_JSON:")) continue;
          try {
            for (const item of toItems(JSON.parse(log.slice(11)), r.outcome.executor_id, t, c)) {
              state.items.push({ ...item, seq: ++state.seq });
            }
          } catch {
            // not ours or malformed
          }
        }
      }
    }
  }
  if (state.items.length > KEEP) state.items.splice(0, state.items.length - KEEP);
}

async function step() {
  const { rpc: url, c } = config();
  const head = await rpc<{ header: { height: number } }>(url, "block", { finality: "final" });
  const target = head.header.height - LAG;
  // start a few minutes back so the feed isn't empty on first load
  state.next ??= Math.max(1, target - 300);
  // catch up in bounded steps; a missing height (skipped block) is just passed over
  for (let n = 0; state.next <= target && n < 50; n++, state.next++) {
    await readBlock(url, state.next, c).catch(() => {});
  }
}

export function startActivity() {
  if (state.running) return;
  state.running = true;
  const loop = async () => {
    await step().catch(() => {});
    setTimeout(loop, 1000);
  };
  void loop();
}

export function activitySince(after: number): ActivityItem[] {
  return state.items.filter((i) => i.seq > after);
}
