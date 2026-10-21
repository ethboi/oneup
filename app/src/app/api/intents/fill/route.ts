// OneUp's solver fills a signed swap (D-21): it checks the user's intent against its quote, signs the
// other side and executes both in one execute_intents call on the Verifier.

import { fill } from "@/lib/server/intents";
import { guard } from "@/lib/server/localnet";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const no = guard(req);
  if (no) return no;
  try {
    const { signed, token, usdcOut } = (await req.json()) as { signed: Parameters<typeof fill>[0]; token: string; usdcOut: string };
    return Response.json(await fill(signed, token, BigInt(usdcOut)));
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e).slice(0, 400) }, { status: 400 });
  }
}
