// A leaderboard of trades closed between `from` and `to` (ms), e.g. one epoch, from the indexer in
// lib/server/activity.ts. Localnet only, like /api/activity.

import { boardBetween, startActivity } from "@/lib/server/activity";
import { guard } from "@/lib/server/localnet";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  startActivity();
  const q = new URL(req.url).searchParams;
  return Response.json(boardBetween(Number(q.get("from") ?? 0), Number(q.get("to") ?? Date.now())));
}
