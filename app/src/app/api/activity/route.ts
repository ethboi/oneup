// The activity feed: OneUp events from recent blocks (see lib/server/activity.ts). `?after=<seq>` returns
// only newer items. On testnet: the indexer's published feed, whole, which the browser filters.

import { activitySince, startActivity } from "@/lib/server/activity";
import { guard } from "@/lib/server/localnet";
import { hasPublicProfile } from "@/lib/server/public-config";
import { published } from "@/lib/server/published";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (hasPublicProfile()) return published("feed", { items: [] });
  const no = guard(req);
  if (no) return no;
  startActivity();
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0) || 0;
  return Response.json({ items: activitySince(after) });
}
