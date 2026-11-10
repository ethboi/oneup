// Closed rounds for the $1UP and House pages (PublishedRounds in lib/tokenomics.ts), as the testnet indexer published
// them. `null` when there is nothing published: the local demo, where the pages ask the chain themselves.

import { hasPublicProfile } from "@/lib/server/public-config";
import { published } from "@/lib/server/published";

export const dynamic = "force-dynamic";

export async function GET() {
  if (hasPublicProfile()) return published("rounds", null);
  return Response.json(null);
}
