import { JsonRpcProvider } from "near-api-js";

/** A rate-limit refusal. FastNEAR's free tier sends it as a JSON-RPC error (code -429) inside an HTTP 200, which
 *  near-api-js does not retry. */
export const isRateLimited = (e: unknown) => /-429|\b429\b|rate limits? exceeded|exceeded your limit|too many requests/i.test(String(e instanceof Error ? e.message : e));

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
    /** Sends through this instead of `url`, such as a FailoverProvider. */
    private readonly through?: JsonRpcProvider,
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
          return await Promise.race([this.through ? this.through.sendJsonRpc(...a) : super.sendJsonRpc(...a), timeout]);
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

/**
 * Public NEAR testnet RPCs that take requests from anywhere, browsers included. They all limit each IP, so the app,
 * keeper and bots fall through them (FailoverProvider). The last two are slow and for when the others refuse.
 */
export const TESTNET_RPCS = [
  "https://testnet-rpc.intea.rs/",
  "https://test.rpc.fastnear.com/",
  "https://near-testnet.drpc.org/",
  "https://rpc.testnet.near.org/",
  "https://archival-rpc.testnet.near.org/",
];
/** The configured RPC first, then the others. */
export const rpcList = (primary: string) => {
  const first = new URL(primary).href;
  return [first, ...TESTNET_RPCS.filter((url) => url !== first)];
};

/** The RPC couldn't answer, as opposed to answering with an error such as a contract panic. */
const isUnavailable = (e: unknown) =>
  e instanceof TypeError || isRateLimited(e) || /retries|attempts|bad gateway|unavailable|timeout|no answer|internal server error|fetch/i.test(String(e instanceof Error ? e.message : e));

/**
 * Reads and sends through the first RPC that isn't resting. One that refuses or fails rests for `restMs` while the
 * others carry on. Each gets a single attempt, because the library's own 12 retries turn one refusal into a burst
 * that keeps the limit tripped. Resending a signed transaction is safe: it has one hash and one nonce.
 */
export class FailoverProvider extends JsonRpcProvider {
  private readonly rpcs: { provider: JsonRpcProvider; restUntil: number }[];

  constructor(
    urls: string[],
    private readonly restMs = 30_000,
    private readonly now = () => Date.now(),
    make = (url: string) => new JsonRpcProvider({ url }, { retries: 1, wait: 0, backoff: 1 }),
    private readonly timeoutMs = 30_000,
  ) {
    super({ url: urls[0]! });
    this.rpcs = urls.map((url) => ({ provider: make(url), restUntil: 0 }));
  }

  // the parent's signature is generic over every RPC method; this only forwards it
  override async sendJsonRpc(...a: Parameters<JsonRpcProvider["sendJsonRpc"]>): Promise<any> {
    const t = this.now();
    const awake = this.rpcs.filter((r) => r.restUntil <= t);
    // all resting: only the one due back soonest, so a tab doesn't hammer every RPC at once
    const order = awake.length ? awake : [this.rpcs.reduce((a, b) => (b.restUntil < a.restUntil ? b : a))];
    let last: unknown;
    for (const rpc of order) {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error(`RPC ${String(a[0])} had no answer in ${this.timeoutMs / 1000} s`)), this.timeoutMs);
        });
        try {
          return await Promise.race([rpc.provider.sendJsonRpc(...a), timeout]);
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        if (!isUnavailable(e)) throw e;
        rpc.restUntil = this.now() + this.restMs;
        last = e;
      }
    }
    throw last;
  }
}
