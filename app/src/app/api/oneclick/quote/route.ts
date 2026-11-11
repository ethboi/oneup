// A dry-run 1Click quote (NEAR Intents, mainnet): what bringing an asset from another chain into USDC on NEAR would
// return. `?asset=<1Click assetId>&amount=0.1`. The quote is never executed: the request says `dry: true`, 1Click
// hands out no deposit address for it, and nothing is signed. Works on the hosted testnet app and on localnet.

import { OneClickError, dryQuote, underLimit, visitor } from "@/lib/server/oneclick";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!underLimit(visitor(req))) return Response.json({ error: "Too many quotes: wait a minute" }, { status: 429 });
  const q = new URL(req.url).searchParams;
  try {
    const quote = await dryQuote(q.get("asset") ?? "", (q.get("amount") ?? "").slice(0, 40));
    // the same ask a few seconds apart gets the same answer from the CDN
    return Response.json(quote, { headers: { "cache-control": "public, s-maxage=15" } });
  } catch (e) {
    const status = e instanceof OneClickError ? e.status : 502;
    const error = e instanceof OneClickError ? e.message : "1Click didn't answer";
    return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
  }
}
