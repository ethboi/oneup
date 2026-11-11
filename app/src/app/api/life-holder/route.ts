// A Life's holder room: opens only for the account that holds the Life right now. The browser sends a NEP-413 message
// naming the Life, signed by the holder's wallet. This checks the signature, that the key is a full-access key of
// that account, and that the account owns the Life on chain at this moment, so the room moves with the NFT: after a
// sale the old owner's signature no longer opens it. Then it returns what the holder has had from the Life.

import { FailoverProvider, OneUp, rpcList } from "@oneup/sdk";
import { lifeHistoryFor, startActivity, type LifeItem } from "@/lib/server/activity";
import { signedMessageProblem, sinceHeld, type HolderRequest } from "@/lib/server/holder";
import { deployment, guard } from "@/lib/server/localnet";
import { hasPublicProfile, publicTestnetConfig } from "@/lib/server/public-config";
import { publishedValue } from "@/lib/server/published";

export const dynamic = "force-dynamic";

const TOKEN = /^(?:[0-9]{1,12}:[a-z0-9._-]{2,64}|b[0-9]{1,12})$/;
const ACCOUNT = /^[a-z0-9._-]{2,64}$/;
const refuse = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  const testnet = hasPublicProfile();
  if (!testnet) {
    const no = guard(req);
    if (no) return no;
  }
  let r: HolderRequest;
  try {
    r = (await req.json()) as HolderRequest;
  } catch {
    return refuse(400, "Send the signed message as JSON.");
  }
  if (!TOKEN.test(String(r.tokenId)) || !ACCOUNT.test(String(r.accountId))) return refuse(400, "Unknown Life or account.");
  const problem = await signedMessageProblem(r, Date.now());
  if (problem) return refuse(401, problem);

  const o = testnet ? new OneUp(publicTestnetConfig(), new FailoverProvider(rpcList(publicTestnetConfig().rpcUrl))) : new OneUp(deployment());
  const key = await o.provider.viewAccessKey({ accountId: r.accountId, publicKey: r.publicKey }).catch(() => null);
  if (!key) return refuse(401, "That key isn't on the account that signed.");
  if (key.permission !== "FullAccess") return refuse(401, "Sign with the account's full-access key (your wallet), not a session key.");
  const life = await o.lifeInfo(r.tokenId);
  if (!life) return refuse(404, "No such Life.");
  if (life.owner_id !== r.accountId) return refuse(403, `Only the Life's current holder can open this room. It is held by ${life.owner_id}.`);

  let items: LifeItem[];
  if (testnet) items = (await publishedValue<{ items: LifeItem[] }>(`life:${r.tokenId}`, { items: [] })).items;
  else {
    startActivity();
    items = lifeHistoryFor(r.tokenId).items;
  }
  return Response.json(
    { holder: r.accountId, checkedAt: Date.now(), claimable: life.claimable, since: sinceHeld(items, r.accountId) },
    { headers: { "cache-control": "no-store" } },
  );
}
