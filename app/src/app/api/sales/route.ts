// The newest marketplace sales, newest first, from the indexer in lib/server/activity.ts. On testnet: what the
// testnet indexer published.

import { recentSales, startActivity } from "@/lib/server/activity";
import { guard } from "@/lib/server/localnet";
import { hasPublicProfile } from "@/lib/server/public-config";
import { published } from "@/lib/server/published";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (hasPublicProfile()) return published("sales", { items: [] });
  const no = guard(req);
  if (no) return no;
  startActivity();
  return Response.json({ items: recentSales() });
}
