// One account's history (trades, deposits, withdrawals, claims, NFTs, market sales), newest first, from the
// indexer in lib/server/activity.ts. `?account=demo.test.near`. Localnet only, like /api/activity.

import { historyFor, startActivity } from "@/lib/server/activity";
import { guard } from "@/lib/server/localnet";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  startActivity();
  const account = new URL(req.url).searchParams.get("account") ?? "";
  return Response.json(historyFor(account));
}
