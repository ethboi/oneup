// Each market's price 24 hours ago, for the 24-hour change. The testnet oracle follows real spot prices (the keeper's
// `live` source), so the real market's 24-hour open is the right base. Coinbase Exchange's public stats answer from
// any region; a market it doesn't list, or a failed request, is left out and the app shows no change for it.

const TTL_MS = 60_000;
let cache: { at: number; ids: string; open: Record<string, number> } | null = null;

async function openOf(id: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.exchange.coinbase.com/products/${encodeURIComponent(id)}/stats`, {
      headers: { "user-agent": "oneup-app" },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const open = Number(((await r.json()) as { open?: string }).open);
    return Number.isFinite(open) && open > 0 ? open : null;
  } catch {
    return null;
  }
}

/** `id` → its price 24 hours ago, cached for a minute. */
export async function open24h(ids: string[]): Promise<Record<string, number>> {
  const key = ids.join(",");
  if (cache && cache.ids === key && Date.now() - cache.at < TTL_MS) return cache.open;
  const rows = await Promise.all(ids.map(async (id) => [id, await openOf(id)] as const));
  const open = Object.fromEntries(rows.filter((r): r is readonly [string, number] => r[1] !== null));
  // keep the last good answer through a failed refresh
  if (Object.keys(open).length > 0 || !cache || cache.ids !== key) cache = { at: Date.now(), ids: key, open };
  return cache.open;
}
