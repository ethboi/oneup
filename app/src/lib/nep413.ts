// NEP-413 signed messages (https://github.com/near/NEPs/blob/master/neps/nep-0413.md), used to open a Life's holder
// room: the wallet signs a message naming the Life, and the server checks the signature, that the key belongs to the
// account, and that the account holds the Life right now. Works in the browser and on the server.

import { serialize } from "borsh";

/** Who the message is for: a signature meant for another site can't open this one. */
export const HOLDER_RECIPIENT = "oneup.markets";
/** How long a signed message opens the room for. */
export const HOLDER_WINDOW_MS = 5 * 60_000;

const TAG = 2 ** 31 + 413;
const PAYLOAD = { struct: { message: "string", nonce: { array: { type: "u8", len: 32 } }, recipient: "string", callbackUrl: { option: "string" } } } as const;

/** The message a holder signs: plain words, so the wallet shows what it is for. */
export function holderMessage(tokenId: string, at: Date): string {
  return `Open the holder room of OneUp Life ${tokenId}\nAt: ${at.toISOString()}`;
}

/** The token id and time a holder message names, or null if it isn't one. */
export function parseHolderMessage(message: string): { tokenId: string; at: number } | null {
  const m = /^Open the holder room of OneUp Life (\S+)\nAt: (\S+)$/.exec(message);
  if (!m) return null;
  const at = Date.parse(m[2]);
  return Number.isFinite(at) ? { tokenId: m[1], at } : null;
}

/** The 32-byte hash a NEP-413 wallet signs. */
export async function nep413Hash(message: string, nonce: Uint8Array, recipient: string): Promise<Uint8Array> {
  if (nonce.length !== 32) throw new Error("A NEP-413 nonce is 32 bytes");
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, TAG, true);
  const body = serialize(PAYLOAD, { message, nonce: Array.from(nonce), recipient, callbackUrl: null });
  const bytes = new Uint8Array(tag.length + body.length);
  bytes.set(tag);
  bytes.set(body, tag.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
