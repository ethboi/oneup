// The last 30 minutes of oracle prices per market, for the chart's first draw (lib/server/prices.ts).
// Localnet only, like /api/activity.

import { recentPrices, startPrices } from "@/lib/server/prices";
import { guard } from "@/lib/server/localnet";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  startPrices();
  return Response.json(recentPrices());
}
