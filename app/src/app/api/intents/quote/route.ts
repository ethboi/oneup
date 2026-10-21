// OneUp's solver quotes (D-21): how much of a bridged asset buys a given amount of USDC.

import { quoteExactOut } from "@/lib/server/intents";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { token, usdcOut } = (await req.json()) as { token: string; usdcOut: string };
    const q = await quoteExactOut(token, BigInt(usdcOut));
    return Response.json({ amountIn: q.amountIn.toString(), price: q.price });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 400 });
  }
}
