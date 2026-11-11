// One Life NFT's own history (minted, sent, sold, claimed), newest first, from the indexer in lib/server/activity.ts.
// `?id=12:bot3.test.near`. On testnet: what the testnet indexer published.

import { lifeHistoryFor, startActivity } from "@/lib/server/activity";
import { guard } from "@/lib/server/localnet";
import { hasPublicProfile } from "@/lib/server/public-config";
import { published } from "@/lib/server/published";

export const dynamic = "force-dynamic";

/** A Life's token id: "<round>:<account>", or a Backer Life's "b<n>" (contracts/extra-life/src/lib.rs). */
const TOKEN = /^(?:[0-9]{1,12}:[a-z0-9._-]{2,64}|b[0-9]{1,12})$/;

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const none = { items: [], complete: false, synced: true };
  if (hasPublicProfile()) return TOKEN.test(id) ? published(`life:${id}`, none) : Response.json(none);
  const no = guard(req);
  if (no) return no;
  startActivity();
  return Response.json(TOKEN.test(id) ? lifeHistoryFor(id) : none);
}
