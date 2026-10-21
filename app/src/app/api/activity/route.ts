// The activity feed: OneUp events from recent blocks (see lib/server/activity.ts). `?after=<seq>` returns
// only newer items. Localnet only, like /api/config.

import { activitySince, startActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  startActivity();
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0) || 0;
  return Response.json({ items: activitySince(after) });
}
