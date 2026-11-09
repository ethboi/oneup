// Failed transactions reported by browsers (lib/report.ts), kept as the newest 200 in the store the testnet indexer
// publishes to. Read them with `pnpm errors`. Testnet only; a report that can't be stored is dropped.

import { hasPublicProfile, publicTestnetConfig } from "@/lib/server/public-config";

export const dynamic = "force-dynamic";

const FIELDS = ["label", "error", "step", "method", "hash", "wallet", "account", "ua", "path"] as const;
const KEEP = 200;

export async function POST(req: Request) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!hasPublicProfile() || !url || !token) return new Response(null, { status: 204 });
  const body = await req.text();
  if (body.length > 4000) return new Response(null, { status: 413 });
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!raw || typeof raw !== "object") return new Response(null, { status: 400 });
  const report: Record<string, string | number> = { t: Date.now() };
  for (const f of FIELDS) if (typeof raw[f] === "string" && raw[f]) report[f] = (raw[f] as string).slice(0, 600);
  if (!report.label || !report.error) return new Response(null, { status: 400 });
  const key = `oneup:${publicTestnetConfig().contracts.house}:errors`;
  try {
    await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["LPUSH", key, JSON.stringify(report)],
        ["LTRIM", key, "0", String(KEEP - 1)],
      ]),
      signal: AbortSignal.timeout(5000),
    });
  } catch {}
  return new Response(null, { status: 204 });
}
