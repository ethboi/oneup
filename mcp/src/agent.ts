// One autonomous AI trading session on the local chain. Claude connects to the OneUp MCP server (src/index.ts),
// reads the markets and its account, decides whether to trade, manages what it holds, looks at the market for
// Extra Lives, and gives a reason for every action; the reasons land in the journal on the app's Agents tab.
// It trades as the AI agent's account (bot12, which the bots leave alone) unless ONEUP_ACCOUNT names another.
//
//   pnpm agent                        with ANTHROPIC_API_KEY: the Claude API, a tool loop over the MCP tools
//   pnpm agent                        without one: the Claude Code CLI (claude -p) with the MCP server attached
//   ONEUP_AGENT_TURNS=10 pnpm agent   fewer tool rounds (default 25)

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MODEL = process.env.ONEUP_AGENT_MODEL ?? "claude-opus-5-5";
const TURNS = Number(process.env.ONEUP_AGENT_TURNS ?? 25);
const SERVER = resolve(import.meta.dirname, "index.ts");

const SYSTEM = `You are an autonomous trader on OneUp, a perpetuals venue on NEAR where traders trade against a house pool. A
net loss in a round where the house makes a profit can mint the trader an Extra Life NFT: USDC to claim and a share of
the house's future profit, up to a limit. Extra Lives can be bought and sold. You act only through the OneUp tools.
This is a local demo chain with test USDC, but trade as if the money were real.

Every action tool takes a "reason": one or two plain sentences on why, citing what you saw (price, your equity, how
close a position is to liquidation, a listing's discount). People read these in the app, so write for them, not for
yourself.

Rules for this session:
- Read how_it_works once, then your account and the markets before acting.
- Risk at most 5% of your equity as margin on any one trade, keep leverage at 25x or below, and set a stop-loss on
  every new trade. At most two new trades this session. Doing nothing is fine when nothing looks good.
- Manage what you already hold: close or re-set exits on positions whose reason no longer holds.
- Claim Extra Lives that can pay. Check market_listings; buy an Extra Life only when it sells below what it can pay
  and you can afford it, and set max_price_usd to the listed price.
- Finish with a short summary of what you did and what you are watching.`;

const KICKOFF = "Start your trading session now.";

if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) await viaApi();
else viaCli();

/** The Claude API: the MCP server's tools become Claude tools; a manual loop runs each call through MCP. */
async function viaApi() {
  const mcp = new Client({ name: "oneup-agent", version: "0.1.0" });
  await mcp.connect(new StdioClientTransport({ command: "npx", args: ["tsx", SERVER], env: process.env as Record<string, string>, stderr: "inherit" }));
  const { tools: listed } = await mcp.listTools();
  const tools: Anthropic.Beta.BetaTool[] = listed.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
  }));

  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: KICKOFF }];
  try {
    for (let turn = 0; turn < TURNS; turn++) {
      const res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: SYSTEM,
        tools,
        messages,
      });
      for (const b of res.content) if (b.type === "text" && b.text.trim()) console.log(`\n${b.text.trim()}`);
      if (res.stop_reason === "refusal") return console.log(`\n(the model declined: ${res.stop_details?.category ?? "no category"})`);
      if (res.stop_reason !== "tool_use" && res.stop_reason !== "pause_turn") return;

      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason === "pause_turn") continue;
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const b of res.content) {
        if (b.type !== "tool_use") continue;
        console.log(`  → ${b.name} ${JSON.stringify(b.input)}`);
        const out = await mcp.callTool({ name: b.name, arguments: b.input as Record<string, unknown> });
        const text = (out.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");
        results.push({ type: "tool_result", tool_use_id: b.id, content: text, is_error: out.isError === true });
      }
      messages.push({ role: "user", content: results });
    }
    console.log(`\n(stopped after ${TURNS} tool rounds)`);
  } finally {
    await mcp.close();
  }
}

/** No API key: hand the session to the Claude Code CLI, with only the OneUp tools allowed. */
function viaCli() {
  const config = { mcpServers: { oneup: { command: "npx", args: ["tsx", SERVER], env: pick("ONEUP_ACCOUNT", "ONEUP_CONFIG", "ONEUP_STATE_DIR", "ONEUP_AI_AGENTS") } } };
  const run = spawnSync(
    "claude",
    ["-p", KICKOFF, "--append-system-prompt", SYSTEM, "--mcp-config", JSON.stringify(config), "--strict-mcp-config", "--allowedTools", "mcp__oneup", "--permission-mode", "dontAsk", "--max-turns", String(TURNS)],
    { stdio: "inherit" },
  );
  if (run.error) {
    console.error("Needs ANTHROPIC_API_KEY or the Claude Code CLI (claude) on the PATH.");
    process.exit(1);
  }
  process.exit(run.status ?? 0);
}

function pick(...keys: string[]) {
  return Object.fromEntries(keys.filter((k) => process.env[k]).map((k) => [k, process.env[k] as string]));
}
