// The OneUp relayer (NEP-366 meta transactions): takes a signed delegate action from the app and submits it,
// paying the gas. It only relays trade calls to the house (place_open, place_close, set_triggers) from local
// accounts, with no deposit and at most 100 Tgas, 10 per sender per 10 s (lib/server/relay.ts), so it can't
// be used to spend anyone's funds or burn its gas on other contracts. Localnet only: the relayer is the
// deployer account from localnet.json.

import { deserialize } from "borsh";
import { Account, JsonRpcProvider, SCHEMA, getTransactionLastResult, type KeyPairString } from "near-api-js";
import { deployment, guard } from "@/lib/server/localnet";
import { underLimit, validateDelegate, type Delegate } from "@/lib/server/relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const no = guard(req);
  if (no) return no;
  try {
    const d = deployment();
    const { signedDelegate } = (await req.json()) as { signedDelegate: string };
    const decoded = deserialize(SCHEMA.SignedDelegate, Buffer.from(signedDelegate, "base64")) as unknown as { delegateAction: Delegate };
    const da = decoded.delegateAction;
    const bad = validateDelegate(da, d.contracts.house);
    if (bad) return Response.json({ error: bad }, { status: 400 });
    if (!underLimit(da.senderId)) return Response.json({ error: "Too many relayed trades: wait a few seconds" }, { status: 429 });
    const relayer = new Account(d.owner.id, new JsonRpcProvider({ url: d.rpcUrl }), d.owner.key as KeyPairString);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await relayer.relayMetaTransaction(decoded as any);
    // the outer transaction succeeds even when the relayed call fails: look inside
    const failed = out.receipts_outcome.find((r) => typeof r.outcome.status === "object" && "Failure" in r.outcome.status);
    if (failed) {
      const why = JSON.stringify((failed.outcome.status as { Failure: unknown }).Failure);
      const m = why.match(/Smart contract panicked: ([^"\\]+)/);
      return Response.json({ error: m ? m[1] : why.slice(0, 200) }, { status: 400 });
    }
    let result: unknown = null;
    try {
      result = getTransactionLastResult(out);
    } catch {}
    return Response.json({ result, tx: out.transaction?.hash });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 500 });
  }
}
