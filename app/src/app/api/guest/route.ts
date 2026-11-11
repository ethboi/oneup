// Guest accounts on testnet (lib/server/guest.ts): GET says whether guest mode is on; POST {publicKey} creates a
// throwaway testnet account for a key made in the browser and answers {accountId}. The server never sees the
// private key.

import { createGuestAccount, guestLimit, sponsor, validGuestKey } from "@/lib/server/guest";
import { hasPublicProfile } from "@/lib/server/public-config";

export const dynamic = "force-dynamic";

const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET() {
  return answer({ available: hasPublicProfile() && !!sponsor() });
}

export async function POST(req: Request) {
  if (!hasPublicProfile() || !sponsor()) return answer({ error: "Guest accounts aren't available here." }, 404);
  let publicKey: unknown;
  try {
    ({ publicKey } = (await req.json()) as { publicKey?: unknown });
  } catch {
    return answer({ error: "Send the public key as JSON." }, 400);
  }
  if (!validGuestKey(publicKey)) return answer({ error: "That isn't an ed25519 public key." }, 400);
  const visitor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const refused = await guestLimit(visitor);
  if (refused) return answer({ error: refused }, 429);
  try {
    return answer({ accountId: await createGuestAccount(publicKey) });
  } catch {
    return answer({ error: "The guest account couldn't be created just now. Try again, or connect a NEAR testnet wallet." }, 502);
  }
}
