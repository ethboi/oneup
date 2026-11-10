"use client";

// The Agents tab: OneUp as a venue AI agents trade on. The AI agent's record and its journal (every action it
// took through the MCP server, with the reason it gave), how to connect your own, and the rule-based bots
// beside it with their strategies and results.

import { useEffect, useState } from "react";
import { BOT_NOTES, BOT_STRATEGIES, USDC, agentOf, fmtUsdc, type JournalEntry } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { useAgents } from "@/lib/agents";
import { lifeValue } from "@/lib/value";
import { useNow } from "./Header";
import { Icon, type IconName } from "./Icon";
import { Empty, Explainer, PanelHead, Stat, SummaryBar } from "./ui";

interface Standing {
  account: string;
  pnl: string;
  trades: number;
  wins: number;
  volume: string;
}

const short = (a: string) => a.split(".")[0];
const usd = (x: bigint, signed = false) => {
  const a = x < 0n ? -x : x;
  return `${x < 0n ? "−" : signed && x > 0n ? "+" : ""}$${fmtUsdc(a, a < 1_000n * USDC ? 2 : 0)}`;
};

/** Everyone's results since the chain began (/api/standings). */
function useStandings() {
  const [rows, setRows] = useState<Standing[] | null>(null);
  useEffect(() => {
    let live = true;
    const tick = () =>
      // on testnet the route takes a period; locally, a time range
      fetch("/api/standings?from=0&period=all")
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((j) => live && setRows(j.rows ?? []))
        .catch(() => {});
    tick();
    const i = setInterval(tick, 20_000);
    return () => {
      live = false;
      clearInterval(i);
    };
  }, []);
  return rows;
}

const TOOL: Record<string, { label: string; icon: IconName }> = {
  open_trade: { label: "Opened", icon: "up" },
  close_trade: { label: "Closed", icon: "x" },
  set_triggers: { label: "Set TP/SL", icon: "edit" },
  claim_lives: { label: "Claimed", icon: "claim" },
  buy_listing: { label: "Bought", icon: "cart" },
};

/** An action in a few words, from its arguments. */
function summary(e: JournalEntry): string {
  const a = e.args as Record<string, string | number | undefined>;
  switch (e.tool) {
    case "open_trade":
      return `${a.side} ${a.market} ${a.leverage}× · $${a.margin_usd}${a.take_profit || a.stop_loss ? " with TP/SL" : ""}`;
    case "close_trade":
      return `position #${a.position_id}`;
    case "set_triggers":
      return `#${a.position_id}: TP ${a.take_profit ?? "–"} / SL ${a.stop_loss ?? "–"}`;
    case "claim_lives":
      return "USDC from its Life NFTs";
    case "buy_listing":
      return `${String(a.nft_contract ?? "").startsWith("life") ? "a Life NFT" : "a $1UP lock"} #${a.token_id}, up to $${a.max_price_usd}`;
    default:
      return e.tool;
  }
}

const ago = (now: number, t: number) => {
  const s = Math.max(0, Math.round(now - t / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86_400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86_400)}d ago`;
};

export function Agents() {
  const { o, d } = useOneUp();
  const { ai, journal } = useAgents();
  const rows = useStandings();
  const now = useNow();
  const testnet = d.network === "testnet";
  // no agent account or journal on testnet: "" reads as an empty account, without asking the chain
  const agentId = testnet ? "" : d.bots.find((b) => short(b.id) === ai[0])?.id ?? `${ai[0]}.test.near`;
  const positions = usePoll(() => o.positions(agentId), [agentId], 10_000) ?? [];
  const lives = usePoll(() => o.lives(agentId), [agentId], 20_000) ?? [];
  const mine = rows?.find((r) => r.account === agentId);
  const pnl = mine ? BigInt(mine.pnl) : 0n;
  const held = lives.filter((l) => !l.expired && !l.full_heal);
  const bought = journal.filter((e) => e.tool === "buy_listing" && e.ok).length;

  if (testnet)
    return (
      <div className="flex flex-col gap-5">
        <Explainer title="Agents" line="OneUp is built to be traded by AI agents as well as people, through its MCP server. Here, rule-based bots keep the market moving.">
          An agent gets the same tools a trader has: markets, quotes, open and close, Life NFTs and the market. Each action goes in a public journal with
          the agent&apos;s own reason. That runs in the local demo; on this testnet site there is no AI agent yet, and the bots below provide the flow you see.
        </Explainer>
        <ConnectAgent local={false} />
        <BotTable accounts={rows?.filter((r) => agentOf(r.account, ai)?.kind === "bot").map((r) => r.account) ?? []} rows={rows} ai={ai} note="Rule-based strategies trading around the clock with test money, so the house always has flow. Updated about once a minute." />
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      <Explainer
        title="Agents"
        line="OneUp is built to be traded by AI agents as well as people. Through its MCP server an agent reads the markets, sizes a trade, sets its exits and buys Life NFTs on the market. Every action is logged here with the reason it gave."
      >
        The MCP server (mcp/) gives any MCP client, such as Claude, the same tools a trader has: markets, quotes, open and close,
        take-profit and stop-loss, Life NFTs and claims, and the market for lives and locks. Each action it takes goes into the journal below
        with any reason the agent gives, so you can see what it did and why. Beside it, rule-based bots trade around the clock, one
        strategy each, so the house always has flow. On this local demo the agent signs with a development key; a mainnet agent would hold a
        constrained session key instead.
      </Explainer>

      <section className="panel divide-y divide-[var(--line)]">
        <div className="flex items-center gap-3 px-4 pt-4">
          <span className="agent-avatar" aria-hidden>
            <Icon name="agent" size={22} />
          </span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-lg font-extrabold">
              {short(agentId)}
              <span className="agent-badge ai">AI</span>
            </h2>
            <p className="label">Trades through the MCP server. The bots leave this account to it.</p>
          </div>
        </div>
        <SummaryBar>
          <Stat label="Profit, all time" value={usd(pnl, true)} tone={pnl > 0n ? "good" : pnl < 0n ? "bad" : undefined} />
          <Stat label="Trades" value={mine ? `${mine.trades}` : "0"} sub={mine && mine.trades ? `${Math.round((mine.wins / mine.trades) * 100)}% won` : undefined} />
          <Stat label="Open positions" value={`${positions.length}`} />
          <Stat label="Life NFTs held" value={`${held.length}`} sub={held.length ? `can still pay ${usd(held.reduce((s, l) => s + lifeValue(l), 0n))}` : bought ? `${bought} bought on the market` : undefined} />
        </SummaryBar>

        <div>
          <PanelHead title={`Journal (${journal.length})`} />
          {journal.length === 0 ? (
            <Empty icon="agent">
              No AI agent has traded yet. Connect one below; its first action shows up here within seconds.
            </Empty>
          ) : (
            <ol className="flex flex-col">
              {journal.slice(0, 40).map((e, i) => {
                const t = TOOL[e.tool] ?? { label: e.tool, icon: "info" as IconName };
                const icon = e.tool === "open_trade" && String((e.args as { side?: string }).side).toLowerCase() === "short" ? "down" : t.icon;
                return (
                  <li key={`${e.t}-${i}`} className="journal-row">
                    <span className={`journal-icon ${e.ok ? "" : "failed"}`} aria-hidden>
                      <Icon name={icon} size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">
                        <b>{t.label}</b> {summary(e)}
                        {!e.ok && <span className="journal-failed">refused</span>}
                      </span>
                      {e.reason && <span className="journal-reason">“{e.reason}”</span>}
                      {!e.ok && e.result && <span className="label block">{e.result.replace(/^Failed: (Error: )?/, "")}</span>}
                    </span>
                    <span className="label num shrink-0">{ago(now, e.t)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>

      <ConnectAgent local agent={short(agentId)} />

      <BotTable accounts={d.bots.map((b) => b.id)} rows={rows} ai={ai} note="Rule-based strategies trading around the clock, so the house always has flow." />
    </div>
  );
}

/** The MCP server's tools (mcp/src/index.ts), by what they do: the first group only reads. */
const MCP_TOOLS: { name: string; does: string; acts?: boolean }[] = [
  { name: "how_it_works", does: "The rules in a few lines. An agent reads this first." },
  { name: "markets", does: "Each market's price, maximum leverage, long and short exposure, and the room left." },
  { name: "account", does: "Wallet and trading balances, open positions with live profit, pending orders and this round's possible Life NFT." },
  { name: "quote_trade", does: "Whether the house would take a trade, with its fee on a win, maximum win and liquidation price. Places nothing." },
  { name: "extra_lives", does: "Its Life NFTs: USDC to claim, the remaining payout limit and the earning period." },
  { name: "market_listings", does: "Life NFTs and $1UP locks for sale, each with its price and what it can still pay or is worth today." },
  { name: "house", does: "The pool, what it would owe if every position hit its maximum win, and the round so far." },
  { name: "open_trade", does: "Places an order to open a position, with optional take-profit and stop-loss. A keeper fills it at a later oracle price.", acts: true },
  { name: "close_trade", does: "Places a close for a position held at least 60 seconds. A keeper settles it.", acts: true },
  { name: "set_triggers", does: "Sets or clears a position's take-profit and stop-loss.", acts: true },
  { name: "claim_lives", does: "Sends the USDC its Life NFTs can claim to its wallet.", acts: true },
  { name: "buy_listing", does: "Buys a Life NFT or a lock at its listed price, paid in wallet USDC.", acts: true },
  { name: "faucet", does: "Mints test USDC to its wallet. Local chain only.", acts: true },
];

const MCP_CLIENT_CONFIG = `{
  "mcpServers": {
    "oneup": {
      "command": "pnpm",
      "args": ["--silent", "--filter", "@oneup/mcp", "start"]
    }
  }
}`;

/** How to point an MCP client at OneUp, and what it can then do. The server signs with the local demo's keys, so on
 *  the testnet site the steps start from the repository. */
function ConnectAgent({ local, agent = "bot12" }: { local: boolean; agent?: string }) {
  const steps = local
    ? `# the MCP server over stdio, as ${agent}
pnpm mcp
# as another account
ONEUP_ACCOUNT=bot3 pnpm mcp
# one autonomous AI session
# (Claude API key, or the claude CLI)
pnpm agent`
    : `git clone https://github.com/ethboi/oneup && cd oneup
pnpm install --frozen-lockfile
pnpm build:contracts
# a local chain with live prices and bots,
# at http://127.0.0.1:3020; leave it running
pnpm demo
# in a second terminal: the MCP server over stdio
pnpm mcp
# or one autonomous AI session
# (Claude API key, or the claude CLI)
pnpm agent`;
  const group = (acts: boolean) => (
    <dl className="mt-1.5 flex flex-col text-sm">
      {MCP_TOOLS.filter((t) => Boolean(t.acts) === acts).map((t) => (
        <div key={t.name} className="grid gap-x-4 border-t border-[var(--line)] py-2 first:border-0 sm:grid-cols-[150px_1fr]">
          <dt className="font-bold" style={{ fontFamily: "ui-monospace, monospace", fontSize: "12.5px" }}>{t.name}</dt>
          <dd className="text-[var(--muted)]">{t.does}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <section className="panel p-4" id="connect">
      <h2 className="font-extrabold">Connect your own agent</h2>
      <p className="label mt-1 max-w-3xl">
        {local
          ? "Any MCP client can trade here. In this repo, Claude Code picks the server up from .mcp.json; anywhere else, run it over stdio. It trades as the AI agent's account unless you name another."
          : "The MCP server signs with the local demo's test keys, so an agent trades on a chain you run yourself, not on this testnet deployment. Three commands start that chain; a fourth starts the server."}
      </p>
      <div className="mt-2 grid gap-x-5 lg:grid-cols-2">
        <div className="min-w-0">
          <pre className="agent-code">{steps}</pre>
        </div>
        <div className="min-w-0">
          <pre className="agent-code">{MCP_CLIENT_CONFIG}</pre>
          <p className="label mt-2">
            The same entry is in the repository&apos;s .mcp.json, which Claude Code loads on its own. For another MCP client, add it to the client&apos;s configuration and start the client from the repository folder.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-x-8 gap-y-4 lg:grid-cols-2">
        <div>
          <h3 className="font-extrabold">Tools that read</h3>
          {group(false)}
        </div>
        <div>
          <h3 className="font-extrabold">Tools that act</h3>
          <p className="label">Trades, claims and purchases take the agent&apos;s reason, which goes into its journal.</p>
          {group(true)}
        </div>
      </div>
    </section>
  );
}

function BotTable({ accounts, rows, ai, note }: { accounts: string[]; rows: Standing[] | null; ai: string[]; note: string }) {
  // a bot's strategy goes with its number, so the table keeps that order whatever the results
  const ordered = [...accounts].sort((a, b) => Number(short(a).replace(/\D/g, "")) - Number(short(b).replace(/\D/g, "")));
  return (
    <section className="panel">
      <div className="px-4 pt-4">
        <h2 className="font-extrabold">The bots</h2>
        <p className="label">{note}</p>
      </div>
      {ordered.length === 0 ? (
        <div className="px-4 py-3">
          <p className="label">{rows ? "No bot has closed a trade yet." : "Loading…"}</p>
        </div>
      ) : (
        <div className="overflow-x-auto px-4 pb-3">
          <table className="num mt-3 w-full text-sm">
            <thead>
              <tr className="label text-left">
                <th className="pb-1.5 font-normal">Bot</th>
                <th className="hidden pb-1.5 font-normal md:table-cell">Strategy</th>
                <th className="pb-1.5 text-right font-normal">Profit</th>
                <th className="pb-1.5 text-right font-normal">Trades</th>
                <th className="hidden pb-1.5 text-right font-normal sm:table-cell">Won</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((id) => {
                const a = agentOf(id, ai);
                const r = rows?.find((x) => x.account === id);
                const p = r ? BigInt(r.pnl) : 0n;
                const strategy = BOT_STRATEGIES[Number(short(id).replace(/\D/g, "")) - 1];
                const note = a?.kind === "ai" ? "Driven by the AI agent" : strategy ? BOT_NOTES[strategy] : "";
                return (
                  <tr key={id} className="border-t border-[var(--line)]">
                    <td className="py-2">
                      <b>{strategy ?? short(id)}</b>
                      <span className="label"> · {short(id)}</span>
                      {a?.kind === "ai" && <span className="agent-badge ai">AI</span>}
                      {/* phones have no Strategy column: what the bot does goes under its name */}
                      {note && <span className="label block md:hidden">{note}</span>}
                    </td>
                    <td className="hidden py-2 text-[var(--muted)] md:table-cell">{note}</td>
                    <td className="whitespace-nowrap py-2 pl-2 text-right font-bold" style={{ color: p > 0n ? "var(--long)" : p < 0n ? "var(--short)" : undefined }}>
                      {r ? usd(p, true) : "–"}
                    </td>
                    <td className="py-2 text-right">{r?.trades ?? 0}</td>
                    <td className="hidden py-2 text-right sm:table-cell">{r && r.trades ? `${Math.round((r.wins / r.trades) * 100)}%` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
