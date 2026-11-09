// Each configured market's price 24 hours ago (lib/server/change24h.ts). Testnet only: the local demo's prices are
// simulated, so a real market's 24-hour change would mean nothing there.

import { open24h } from "@/lib/server/change24h";
import { hasPublicProfile, publicTestnetConfig } from "@/lib/server/public-config";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasPublicProfile()) return Response.json({});
  const ids = publicTestnetConfig().markets.map((m) => m.id);
  return Response.json(await open24h(ids), { headers: { "Cache-Control": "public, max-age=60" } });
}
