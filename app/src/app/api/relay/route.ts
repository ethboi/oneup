// The OneUp relayer (NEP-366 meta transactions): takes a signed delegate action from the app and submits it,
// paying the gas. It only relays trade calls to the house (place_open, place_close, set_triggers) with no
// deposit, so it can't be used to spend anyone's funds or burn its gas on other contracts. Localnet only:
// the relayer is the deployer account from localnet.json.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deserialize } from "borsh";
import { Account, JsonRpcProvider, SCHEMA, getTransactionLastResult, type KeyPairString } from "near-api-js";

export const dynamic = "force-dynamic";

const ALLOWED = ["place_open", "place_close", "set_triggers"];

interface Decoded {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: { functionCall?: { methodName: string; deposit: bigint } }[];
  };
}

export async function POST(req: Request) {
  try {
    const d = JSON.parse(readFileSync(resolve(process.cwd(), "../localnet.json"), "utf8"));
    const { signedDelegate } = (await req.json()) as { signedDelegate: string };
    const decoded = deserialize(SCHEMA.SignedDelegate, Buffer.from(signedDelegate, "base64")) as unknown as Decoded;
    const da = decoded.delegateAction;
    const ok =
      da.receiverId === d.contracts.house &&
      da.actions.length === 1 &&
      !!da.actions[0].functionCall &&
      ALLOWED.includes(da.actions[0].functionCall.methodName) &&
      BigInt(da.actions[0].functionCall.deposit) === 0n;
    if (!ok) return Response.json({ error: "The relayer only pays for trades on the house" }, { status: 400 });
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
