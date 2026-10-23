// Every jackpot draw the indexer has seen, newest first (see lib/server/activity.ts). Localnet only.

import { jackpotDraws, startActivity } from "@/lib/server/activity";
import { guard } from "@/lib/server/localnet";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  startActivity();
  return Response.json({ items: jackpotDraws() });
}
