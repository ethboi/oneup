// The simulated bridge (D-21): mints a bridged asset into the NEAR Intents Verifier for an account, as a
// real bridge would after a deposit on the source chain. Localnet only; capped per call.

import { bridgeIn } from "@/lib/server/intents";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { account, token, amount } = (await req.json()) as { account: string; token: string; amount: string };
    if (!/\.test\.near$/.test(account)) throw new Error("Local accounts only");
    await bridgeIn(account, token, BigInt(amount));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 400 });
  }
}
