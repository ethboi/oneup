// What the RPC proxy (/api/rpc) passes on: the read and send methods near-api-js uses, never the sandbox's
// own (`sandbox_patch_state` rewrites any account's state, `sandbox_fast_forward` skips blocks).

const METHODS = new Set([
  "query",
  "block",
  "chunk",
  "tx",
  "status",
  "gas_price",
  "validators",
  "send_tx",
  "broadcast_tx_commit",
  "broadcast_tx_async",
  "EXPERIMENTAL_tx_status",
  "EXPERIMENTAL_receipt",
  "EXPERIMENTAL_protocol_config",
  "EXPERIMENTAL_changes",
  "EXPERIMENTAL_changes_in_block",
]);

/** Largest request body the proxy forwards. */
export const MAX_RPC_BODY = 64 * 1024;

export const allowed = (method: unknown) => typeof method === "string" && METHODS.has(method);

/** null if every call in `body` (one JSON-RPC request or a batch) is allowed, else why not and the status. */
export function checkRpc(body: string): { status: number; error: string } | null {
  if (body.length > MAX_RPC_BODY) return { status: 413, error: "Request too large" };
  let j: unknown;
  try {
    j = JSON.parse(body);
  } catch {
    return { status: 400, error: "Bad JSON" };
  }
  const calls = Array.isArray(j) ? j : [j];
  if (!calls.length) return { status: 400, error: "Empty batch" };
  const bad = calls.find((c) => !allowed((c as { method?: unknown } | null)?.method));
  return bad === undefined ? null : { status: 403, error: `Method not allowed: ${String((bad as { method?: unknown } | null)?.method).slice(0, 60)}` };
}
