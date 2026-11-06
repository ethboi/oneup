// One account's history (trades, deposits, withdrawals, claims, NFTs, market sales), newest first, from the
// indexer in lib/server/activity.ts. `?account=demo.test.near`. On testnet: what the testnet indexer published.

import { historyFor, startActivity } from "@/lib/server/activity";
import { guard } from "@/lib/server/localnet";
import { hasPublicProfile } from "@/lib/server/public-config";
import { published } from "@/lib/server/published";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (hasPublicProfile()) {
    const named = new URL(req.url).searchParams.get("account") ?? "";
    const none = { items: [], synced: true, progress: 1 };
    return /^[a-z0-9._-]{2,64}$/.test(named) ? published(`history:${named}`, none) : Response.json(none);
  }
  const no = guard(req);
  if (no) return no;
  startActivity();
  const account = new URL(req.url).searchParams.get("account") ?? "";
  return Response.json(historyFor(account));
}
