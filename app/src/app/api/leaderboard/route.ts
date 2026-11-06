// A leaderboard of trades closed between `from` and `to` (ms), e.g. one epoch, from the indexer in
// lib/server/activity.ts. On testnet: a closed round's, as the testnet indexer published it.

import { boardBetween, startActivity } from "@/lib/server/activity";
import { guard } from "@/lib/server/localnet";
import { hasPublicProfile } from "@/lib/server/public-config";
import { published } from "@/lib/server/published";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (hasPublicProfile()) {
    const from = new URL(req.url).searchParams.get("from") ?? "";
    const none = { top: [], best: null, biggestLoss: null, synced: false };
    return /^\d{1,16}$/.test(from) ? published(`board:${from}`, none) : Response.json(none);
  }
  const no = guard(req);
  if (no) return no;
  startActivity();
  const q = new URL(req.url).searchParams;
  return Response.json(boardBetween(Number(q.get("from") ?? 0), Number(q.get("to") ?? Date.now())));
}
