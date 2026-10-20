// Serves localnet.json to the browser. Localnet only: it carries the throwaway dev keys `pnpm localnet`
// generated, which is what lets the app sign as the demo trader and the bots without a wallet.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = await readFile(resolve(process.cwd(), "../localnet.json"), "utf8");
    return new Response(raw, { headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "No localnet.json. Run `pnpm localnet` first." }, { status: 503 });
  }
}
