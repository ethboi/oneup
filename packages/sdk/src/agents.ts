// Who trades on OneUp besides people: the twelve rule-based bots (bots/, one strategy each, in bot order) and
// AI agents that trade through the MCP server (mcp/). By default the AI agent signs as bot12, which the bots
// then leave alone; ONEUP_AI_AGENTS (comma-separated, "bot12" or a full id) names others.

/** The bots' strategies, bot1 first. */
export const BOT_STRATEGIES = ["degen", "trend", "fader", "whale", "scalper", "collector", "momentum", "breakout", "gambler", "hodler", "swing", "contrarian"] as const;

/** What each bot does, in a line. */
export const BOT_NOTES: Record<(typeof BOT_STRATEGIES)[number], string> = {
  degen: "Coin-flip side at 50–100×; sells its Extra Lives and locks below value",
  trend: "Follows the 10-tick average; buys listings under 90% of value",
  fader: "Fades the 10-tick average; locks $1UP to sell",
  whale: "Big margin at 2–5×; buys listings under 85% of value",
  scalper: "Short holds on the last few ticks",
  collector: "Small trades; locks for two years and buys listings under 65% of value",
  momentum: "Trades a break of the 30-tick average",
  breakout: "Trades a new 20-tick high or low at 20–50×",
  gambler: "Tiny margin at 100×, every time",
  hodler: "Mostly long, low leverage, long holds",
  swing: "Coin-flip side at 8–20×, longer holds",
  contrarian: "Bets against the last six ticks' move",
};

/** The accounts an AI agent drives by default. */
export const DEFAULT_AI_AGENTS = ["bot12"];

const short = (id: string) => id.split(".")[0];

/** An account as the app shows it: our bots by their first name, a local demo account without its suffix. */
export const displayAccount = (account: string) => (/^bot\d+\./.test(account) ? short(account) : account.replace(/\.test\.near$/, ""));

/** The AI agents' short names, from a comma-separated list (ONEUP_AI_AGENTS) or the default. */
export function aiAgents(env?: string): string[] {
  const list = env?.split(",").map((x) => short(x.trim())).filter(Boolean);
  return list?.length ? list : DEFAULT_AI_AGENTS;
}

export type AgentKind = "ai" | "bot";

/** What an account is: an AI agent, a bot (with its strategy), or a person (null). */
export function agentOf(account: string, ai: string[] = DEFAULT_AI_AGENTS): { kind: AgentKind; name: string } | null {
  const s = short(account);
  if (ai.includes(s)) return { kind: "ai", name: "AI agent" };
  const n = /^bot(\d+)$/.exec(s);
  if (n) {
    const strategy = BOT_STRATEGIES[Number(n[1]) - 1];
    return { kind: "bot", name: strategy ?? s };
  }
  return null;
}

/** One entry in the AI agent's journal (written by the MCP server): what it did, and why it said it did it. */
export interface JournalEntry {
  t: number;
  account: string;
  tool: string;
  args: Record<string, unknown>;
  reason?: string;
  ok: boolean;
  result?: string;
}
