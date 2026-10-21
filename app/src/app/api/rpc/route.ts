// Forwards JSON-RPC to the local chain, so a phone on the same network (`pnpm demo --lan`) can use the
// app: the chain's RPC listens on 127.0.0.1 only. Only the methods the app uses (lib/server/rpc.ts), up to
// 64 KB. Localnet only, like /api/config.

import { deployment, guard } from "@/lib/server/localnet";
import { MAX_RPC_BODY, checkRpc } from "@/lib/server/rpc";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const no = guard(req);
  if (no) return no;
  let rpcUrl: string;
  try {
    rpcUrl = deployment().rpcUrl;
  } catch {
    return Response.json({ error: "No localnet.json. Run `pnpm localnet` first." }, { status: 503 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_RPC_BODY) return Response.json({ error: "Request too large" }, { status: 413 });
  const body = await req.text();
  const bad = checkRpc(body);
  if (bad) return Response.json({ error: bad.error }, { status: bad.status });
  const r = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body });
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
