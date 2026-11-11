// The checks behind a Life's holder room (app/api/life-holder): the signed NEP-413 message, and what the holder has
// had from the Life since it came to them.

import { PublicKey } from "near-api-js";
import { HOLDER_RECIPIENT, HOLDER_WINDOW_MS, fromBase64, nep413Hash, parseHolderMessage } from "../nep413.ts";
import type { LifeItem } from "./activity.ts";

export interface HolderRequest {
  tokenId: string;
  accountId: string;
  publicKey: string;
  /** base64, as NEP-413 wallets return it. */
  signature: string;
  /** base64 of the 32-byte nonce. */
  nonce: string;
  message: string;
}

/** Why the signed message can't open the room, or null if it can: it names this Life, it is recent, and the key signed
 *  it for this site. Whether the key is the account's, and whether the account holds the Life, are checked on chain. */
export async function signedMessageProblem(r: HolderRequest, now: number): Promise<string | null> {
  const m = parseHolderMessage(r.message);
  if (!m || m.tokenId !== r.tokenId) return "The signed message doesn't name this Life.";
  if (Math.abs(now - m.at) > HOLDER_WINDOW_MS) return "The signed message has expired. Sign again.";
  try {
    const hash = await nep413Hash(r.message, fromBase64(r.nonce), HOLDER_RECIPIENT);
    if (PublicKey.fromString(r.publicKey).verify(hash, fromBase64(r.signature))) return null;
  } catch {
    // malformed key, nonce or signature
  }
  return "The signature doesn't match the message.";
}

export interface SinceHeld {
  /** How the Life came to the holder; "unknown" when its history doesn't reach that far. */
  how: "minted" | "bought" | "received" | "unknown";
  t?: number;
  from?: string;
  /** What the holder paid, when they bought it. USDC, 6 decimals. */
  price?: string;
  /** Claims of this Life alone since then: exactly what it paid the holder. */
  claimed: string;
  /** Claims that covered several Lives at once since then: their totals, which include this Life's share. */
  shared: { amount: string; lives: number }[];
}

/** What the holder has had from the Life since it came to them, from its history, newest first. */
export function sinceHeld(items: LifeItem[], account: string): SinceHeld {
  let claimed = 0n;
  const shared: { amount: string; lives: number }[] = [];
  for (const i of items) {
    if (i.kind === "claimed" && i.owner === account) {
      if (i.lives === 1) claimed += BigInt(i.amount);
      else shared.push({ amount: i.amount, lives: i.lives });
    } else if (i.kind === "minted" && i.owner === account) return { how: "minted", t: i.t, claimed: String(claimed), shared };
    else if (i.kind === "sold" && i.to === account) return { how: "bought", t: i.t, from: i.from, price: i.price, claimed: String(claimed), shared };
    else if (i.kind === "transferred" && i.to === account) return { how: "received", t: i.t, from: i.from, claimed: String(claimed), shared };
  }
  return { how: "unknown", claimed: String(claimed), shared };
}
