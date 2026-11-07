// The last 30 minutes of oracle prices per market, for the chart's first draw. Locally the server records them
// (lib/server/prices.ts); on testnet the indexer does and publishes them (scripts/testnet-indexer.ts).

import { recentPrices, startPrices } from "@/lib/server/prices";
import { guard } from "@/lib/server/localnet";
import { hasPublicProfile } from "@/lib/server/public-config";
import { published } from "@/lib/server/published";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (hasPublicProfile()) return published("prices", {});
  const no = guard(req);
  if (no) return no;
  startPrices();
  return Response.json(recentPrices());
}
