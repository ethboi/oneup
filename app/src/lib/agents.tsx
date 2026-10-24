"use client";

// Who's an agent, for the badges and the Agents tab: the AI agents (from /api/agents, which knows
// ONEUP_AI_AGENTS and who has used the MCP server) and the rule-based bots by strategy (lib agents.ts).

import { useEffect, useState } from "react";
import { DEFAULT_AI_AGENTS, agentOf, type JournalEntry } from "@oneup/sdk";

interface Agents {
  ai: string[];
  journal: JournalEntry[];
}

let cache: Agents = { ai: DEFAULT_AI_AGENTS, journal: [] };
const subs = new Set<(a: Agents) => void>();
let started = false;

function start() {
  if (started) return;
  started = true;
  const tick = () =>
    fetch("/api/agents")
      .then((r) => (r.ok ? r.json() : null))
      .then((a: Agents | null) => {
        if (!a) return;
        cache = a;
        subs.forEach((f) => f(a));
      })
      .catch(() => {});
  tick();
  setInterval(tick, 10_000);
}

/** The agents and the journal, kept fresh every 10 s (one poll for the whole page). */
export function useAgents(): Agents {
  const [a, set] = useState(cache);
  useEffect(() => {
    start();
    subs.add(set);
    set(cache);
    return () => void subs.delete(set);
  }, []);
  return a;
}

/** What an account is to the page: an AI agent, a bot and its strategy, or a person (null). */
export function useAgentOf() {
  const { ai } = useAgents();
  return (account?: string) => (account ? agentOf(account, ai) : null);
}
