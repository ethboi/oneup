// The agents trading on OneUp: which accounts are AI agents (ONEUP_AI_AGENTS, bot12 by default) and which are
// rule-based bots, and the AI agents' journal (written by the MCP server: every action with its stated reason),
// newest first. Localnet only, like /api/activity.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { aiAgents, type JournalEntry } from "@oneup/sdk";
import { guard, stateDir } from "@/lib/server/localnet";

export const dynamic = "force-dynamic";

const KEEP = 200;

export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  const file = resolve(stateDir(), "agent-journal.jsonl");
  let journal: JournalEntry[] = [];
  try {
    if (existsSync(file)) {
      journal = readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .slice(-KEEP)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as JournalEntry];
          } catch {
            return [];
          }
        })
        .reverse();
    }
  } catch {
    // unreadable: show none
  }
  const ai = aiAgents(process.env.ONEUP_AI_AGENTS);
  // an account that has used the MCP server is an AI agent too, whatever the list says
  for (const e of journal) if (!ai.includes(e.account.split(".")[0])) ai.push(e.account.split(".")[0]);
  return Response.json({ ai, journal });
}
