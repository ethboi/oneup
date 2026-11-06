// Every jackpot draw the indexer has seen, newest first (see lib/server/activity.ts). On testnet: what the testnet indexer published.

import { jackpotDraws, startActivity } from "@/lib/server/activity";
import { guard } from "@/lib/server/localnet";
import { hasPublicProfile } from "@/lib/server/public-config";
import { published } from "@/lib/server/published";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (hasPublicProfile()) return published("jackpots", { items: [] });
  const no = guard(req);
  if (no) return no;
  startActivity();
  return Response.json({ items: jackpotDraws() });
}
