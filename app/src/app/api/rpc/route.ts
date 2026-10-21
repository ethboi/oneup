// Forwards JSON-RPC to the local chain, so a phone on the same network (`pnpm demo --lan`) can use the
// app: the chain's RPC listens on 127.0.0.1 only. Localnet only, like /api/config.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let rpcUrl: string;
  try {
    rpcUrl = JSON.parse(await readFile(resolve(process.cwd(), "../localnet.json"), "utf8")).rpcUrl;
  } catch {
    return Response.json({ error: "No localnet.json. Run `pnpm localnet` first." }, { status: 503 });
  }
  const r = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: await req.text() });
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
