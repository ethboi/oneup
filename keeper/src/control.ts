// Checks for the keeper's price control port. It listens on 127.0.0.1, but any web page can still post to
// that: a JSON content type forces a CORS preflight the server never answers, and nothing in OneUp calls it
// from a browser (curl and scripts send no Origin), so a request with any Origin is refused.

import type { IncomingHttpHeaders } from "node:http";

export type Steer = { market: string; target: number };

/** Largest steer, either way: also keeps each eased step under the keeper's jump check (prices.ts). */
const MAX_MOVE_PCT = 50;

/** The steer a request asks for, or why it's refused with its status. `prices` are the last ones sent. */
export function validSteer(body: string, headers: IncomingHttpHeaders, prices: Map<string, number>): Steer | { status: number; error: string } {
  if (headers.origin !== undefined) return { status: 403, error: "no browsers" };
  if (!/^application\/json\b/i.test(headers["content-type"] ?? "")) return { status: 415, error: "send content-type: application/json" };
  let j: { market?: unknown; price?: unknown; movePct?: unknown };
  try {
    j = JSON.parse(body);
  } catch {
    return { status: 400, error: "bad JSON" };
  }
  const now = typeof j.market === "string" ? prices.get(j.market) : undefined;
  if (!now) return { status: 400, error: `unknown market ${String(j.market)}` };
  const pct =
    j.price !== undefined && j.movePct === undefined && typeof j.price === "number" && Number.isFinite(j.price) && j.price > 0
      ? (j.price / now - 1) * 100
      : j.price === undefined && typeof j.movePct === "number"
        ? j.movePct
        : NaN;
  if (!Number.isFinite(pct)) return { status: 400, error: "send a price > 0 or a movePct" };
  if (pct <= -MAX_MOVE_PCT || pct > MAX_MOVE_PCT) return { status: 400, error: `moves are limited to (-${MAX_MOVE_PCT}%, ${MAX_MOVE_PCT}%]` };
  return { market: j.market as string, target: j.price !== undefined ? (j.price as number) : now * (1 + pct / 100) };
}
