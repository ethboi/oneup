"use client";

// The Agents tab: OneUp as a venue AI agents trade on. The AI agent's record and its journal (every action it
// took through the MCP server, with the reason it gave), how to connect your own, and the twelve rule-based bots
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
      fetch("/api/standings?from=0")
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
      return "USDC from its Extra Lives";
    case "buy_listing":
      return `${String(a.nft_contract ?? "").startsWith("life") ? "an Extra Life" : "a $1UP lock"} #${a.token_id}, up to $${a.max_price_usd}`;
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
  const agentId = d.bots.find((b) => short(b.id) === ai[0])?.id ?? `${ai[0]}.test.near`;
  const positions = usePoll(() => o.positions(agentId), [agentId], 10_000) ?? [];
  const lives = usePoll(() => o.lives(agentId), [agentId], 20_000) ?? [];
  const mine = rows?.find((r) => r.account === agentId);
  const pnl = mine ? BigInt(mine.pnl) : 0n;
  const held = lives.filter((l) => !l.expired && !l.full_heal);
  const bought = journal.filter((e) => e.tool === "buy_listing" && e.ok).length;

  return (
    <div className="flex flex-col gap-5">
      <Explainer
        title="Agents"
        line="OneUp is built to be traded by AI agents as well as people. Through its MCP server an agent reads the markets, sizes a trade, sets its exits and buys Extra Lives on the market. Every action is logged here with the reason it gave."
      >
        The MCP server (mcp/) gives any MCP client, such as Claude, the same tools a trader has: markets, quotes, open and close,
        take-profit and stop-loss, Extra Lives and claims, and the market for lives and locks. Each action it takes goes into the journal below
        with the agent&apos;s own reason, so you can see what it did and why. Beside it, twelve rule-based bots trade around the clock, one
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
          <Stat label="Extra Lives held" value={`${held.length}`} sub={held.length ? `can still pay ${usd(held.reduce((s, l) => s + lifeValue(l), 0n))}` : bought ? `${bought} bought on the market` : undefined} />
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

      <section className="panel p-4">
        <h2 className="font-extrabold">Connect your own agent</h2>
        <p className="label mt-1 max-w-3xl">
          Any MCP client can trade here. In this repo, Claude Code picks the server up from .mcp.json; anywhere else, run it over stdio. It trades
          as the AI agent&apos;s account unless you name another.
        </p>
        <pre className="agent-code">
          {`# the MCP server over stdio, as ${short(agentId)}
pnpm mcp
# as another account
ONEUP_ACCOUNT=bot3 pnpm mcp
# one autonomous AI session
# (Claude API key, or the claude CLI)
pnpm agent`}
        </pre>
        <p className="label mt-2">Tools: how_it_works, markets, account, quote_trade, open_trade, close_trade, set_triggers, extra_lives, claim_lives, market_listings, buy_listing, house, faucet.</p>
      </section>

      <section className="panel">
        <div className="px-4 pt-4">
          <h2 className="font-extrabold">The bots</h2>
          <p className="label">Twelve rule-based strategies trading around the clock, so the house always has flow.</p>
        </div>
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
              {d.bots.map((b, i) => {
                const a = agentOf(b.id, ai);
                const r = rows?.find((x) => x.account === b.id);
                const p = r ? BigInt(r.pnl) : 0n;
                const strategy = BOT_STRATEGIES[i];
                return (
                  <tr key={b.id} className="border-t border-[var(--line)]">
                    <td className="py-2">
                      <b>{strategy ?? short(b.id)}</b>
                      <span className="label"> · {short(b.id)}</span>
                      {a?.kind === "ai" && <span className="agent-badge ai">AI</span>}
                    </td>
                    <td className="hidden py-2 text-[var(--muted)] md:table-cell">{a?.kind === "ai" ? "Driven by the AI agent" : strategy ? BOT_NOTES[strategy] : ""}</td>
                    <td className="py-2 text-right font-bold" style={{ color: p > 0n ? "var(--long)" : p < 0n ? "var(--short)" : undefined }}>
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
      </section>
    </div>
  );
}
