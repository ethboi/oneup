// Every trader's results over a period (`from`, `to` in ms), for the leaderboard, from the indexer in
// lib/server/activity.ts. On testnet: `?period=round|day|all`, as the testnet indexer published it.

import { standings, startActivity } from "@/lib/server/activity";
import { guard } from "@/lib/server/localnet";
import { hasPublicProfile } from "@/lib/server/public-config";
import { published } from "@/lib/server/published";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (hasPublicProfile()) {
    const period = new URL(req.url).searchParams.get("period");
    return published(`standings:${period === "round" || period === "day" ? period : "all"}`, { rows: [], synced: false });
  }
  const no = guard(req);
  if (no) return no;
  startActivity();
  const q = new URL(req.url).searchParams;
  return Response.json(standings(Number(q.get("from") ?? 0), Number(q.get("to") ?? Date.now())));
}
