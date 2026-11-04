import { JsonRpcProvider } from "near-api-js";

/** A rate-limit refusal. FastNEAR's free tier sends it as a JSON-RPC error (code -429) inside an HTTP 200, which
 *  near-api-js does not retry. */
export const isRateLimited = (e: unknown) => /-429|rate limits? exceeded|too many requests/i.test(String(e instanceof Error ? e.message : e));

/**
 * A provider that spaces its requests at least `gapMs` apart and, when the RPC refuses one for its rate limit,
 * waits and sends it again. A refused request never reached the chain, so resending a transaction is safe.
 * Each process on one machine shares its provider's limit, so the keeper's loops queue here rather than all
 * failing together. A request with no answer after `timeoutMs` fails (it is not resent: a transaction may have
 * landed), so one hung connection never stops a loop that awaits it.
 */
export class PacedProvider extends JsonRpcProvider {
  sent = 0;
  limited = 0;
  /** Requests sent per RPC method (with a contract view's method name), for finding what uses the limit. */
  readonly byMethod = new Map<string, number>();
  private next = 0;

  constructor(
    url: string,
    private readonly gapMs: number,
    private readonly retries = 5,
    private readonly sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    private readonly timeoutMs = 60_000,
  ) {
    super({ url });
  }

  // the parent's signature is generic over every RPC method; this only forwards it
  override async sendJsonRpc(...a: Parameters<JsonRpcProvider["sendJsonRpc"]>): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      const now = Date.now();
      const at = Math.max(now, this.next);
      this.next = at + this.gapMs;
      if (at > now) await this.sleep(at - now);
      this.sent++;
      const p = a[1] as { request_type?: string; method_name?: string } | undefined;
      const key = [String(a[0]), p?.request_type, p?.method_name].filter(Boolean).join(" ");
      this.byMethod.set(key, (this.byMethod.get(key) ?? 0) + 1);
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error(`RPC ${String(a[0])} had no answer in ${this.timeoutMs / 1000} s`)), this.timeoutMs);
        });
        try {
          return await Promise.race([super.sendJsonRpc(...a), timeout]);
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        if (!isRateLimited(e) || attempt >= this.retries) throw e;
        this.limited++;
        // back off every queued request, not just this one: the limit is the provider's
        this.next = Math.max(this.next, Date.now() + 1000 * 2 ** attempt);
      }
    }
  }
}
