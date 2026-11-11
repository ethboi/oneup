// Where a 1Click swap is (NEAR Intents, mainnet), by the deposit address its quote gave:
// `?depositAddress=...&depositMemo=...` (the memo only where the quote had one). Reads only.

import { OneClickError, depositStatus, underLimit, visitor } from "@/lib/server/oneclick";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!underLimit(visitor(req))) return Response.json({ error: "Too many checks: wait a minute" }, { status: 429 });
  const q = new URL(req.url).searchParams;
  try {
    const status = await depositStatus((q.get("depositAddress") ?? "").trim(), (q.get("depositMemo") ?? "").trim() || undefined);
    return Response.json(status, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof OneClickError ? e.status : 502;
    const error = e instanceof OneClickError ? e.message : "1Click didn't answer";
    return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
  }
}
