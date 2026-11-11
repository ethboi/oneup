// What the testnet indexer (scripts/testnet-indexer.ts) has published, for the hosted app's API routes. The CDN keeps
// each answer for a little while, so traffic doesn't turn into reads of the store.

import { publicTestnetConfig } from "./public-config";

const CACHE = "public, s-maxage=20, stale-while-revalidate=40";

/** The JSON stored under `name`, as a response; `empty` when there's no store or nothing there yet. */
export async function published(name: string, empty: unknown): Promise<Response> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_READ_ONLY_TOKEN ?? process.env.KV_REST_API_TOKEN;
  const answer = (body: string) => new Response(body, { headers: { "content-type": "application/json", "cache-control": CACHE } });
  if (!url || !token) return answer(JSON.stringify(empty));
  try {
    const key = `oneup:${publicTestnetConfig().contracts.house}:${name}`;
    const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw Error(String(r.status));
    const { result } = (await r.json()) as { result: string | null };
    return answer(result ?? JSON.stringify(empty));
  } catch {
    // not cached: the next request tries again
    return Response.json(empty, { headers: { "cache-control": "no-store" } });
  }
}

/** The JSON stored under `name`, parsed; `empty` when there's no store or nothing there. For server code that needs the
 *  value itself rather than a response. */
export async function publishedValue<T>(name: string, empty: T): Promise<T> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_READ_ONLY_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return empty;
  try {
    const key = `oneup:${publicTestnetConfig().contracts.house}:${name}`;
    const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return empty;
    const { result } = (await r.json()) as { result: string | null };
    return result ? (JSON.parse(result) as T) : empty;
  } catch {
    return empty;
  }
}
