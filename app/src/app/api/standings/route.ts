// Every trader's results over a period (`from`, `to` in ms), for the leaderboard, from the indexer in
// lib/server/activity.ts. Localnet only, like /api/activity.

import { standings, startActivity } from "@/lib/server/activity";
import { guard } from "@/lib/server/localnet";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  startActivity();
  const q = new URL(req.url).searchParams;
  return Response.json(standings(Number(q.get("from") ?? 0), Number(q.get("to") ?? Date.now())));
}
