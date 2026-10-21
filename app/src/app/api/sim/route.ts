// The early-vs-late simulation results (`pnpm sim` writes them).

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { guard } from "@/lib/server/localnet";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  try {
    const raw = await readFile(resolve(process.cwd(), "../sim/out/results.json"), "utf8");
    return new Response(raw, { headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "No simulation results. Run `pnpm sim`." }, { status: 503 });
  }
}
