// The website's live numbers, read from the testnet contracts on the server and refreshed every few minutes.
// Anything that can't be read leaves the strip out rather than showing a wrong number.
import { hasPublicProfile, publicTestnetConfig } from "@/lib/server/public-config";

export interface LiveStats {
  roundsClosed: number;
  livesMinted: number;
  paidUsdc: number;
  /** Life NFTs whose owner is no longer the account that earned them: sold or transferred. */
  newOwner: number;
}

async function view<T>(rpc: string, account: string, method: string, args: object = {}): Promise<T> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "site",
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
    }),
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json();
  if (!res.ok || body.error || body.result?.error) throw new Error(`${account}.${method} failed`);
  return JSON.parse(Buffer.from(body.result.result).toString());
}

export async function liveStats(): Promise<LiveStats | null> {
  if (!hasPublicProfile()) return null;
  try {
    const d = publicTestnetConfig();
    const { house, life } = d.contracts;
    const [epoch, lives, supply] = await Promise.all([
      view<{ id: number }>(d.rpcUrl, house, "get_epoch"),
      view<{ lives_paid: string }>(d.rpcUrl, house, "get_lives_state"),
      view<string>(d.rpcUrl, life, "nft_total_supply"),
    ]);
    const tokens: { token_id: string; owner_id: string }[] = [];
    for (let from = 0; from < Number(supply); from += 50) {
      tokens.push(...(await view<{ token_id: string; owner_id: string }[]>(d.rpcUrl, life, "nft_tokens", { from_index: String(from), limit: 50 })));
    }
    // a trader's Life is "<round>:<the account that earned it>"; a backer's has no round
    const earned = tokens.filter((t) => t.token_id.includes(":"));
    return {
      roundsClosed: Math.max(0, epoch.id - 1),
      livesMinted: earned.length,
      paidUsdc: Number(BigInt(lives.lives_paid)) / 1e6,
      newOwner: earned.filter((t) => t.token_id.slice(t.token_id.indexOf(":") + 1) !== t.owner_id).length,
    };
  } catch {
    return null;
  }
}
