// The server's side of the 1Click panel: asks NEAR Intents' 1Click API (mainnet; it has no testnet) for a dry-run
// quote, and for the status of a deposit address. A dry run moves nothing and hands out no deposit address, so
// this signs nothing and holds no key. `dry: true` is fixed in the one place a quote request is built.
// Field names: lib/oneclick.ts.

import { parseTokenAmount } from "@oneup/sdk";
import { NOT_FOUND, ONECLICK, USDC_ON_NEAR, originOf, validDepositAddress, validMemo, type DryQuote, type Origin, type StatusAnswer } from "../oneclick.ts";

const HEADERS = { "Content-Type": "application/json", "User-Agent": "oneup-dry-quote" };
/** How long 1Click gets to answer. */
const TIMEOUT_MS = 15_000;
/** A dry run delivers nothing, but 1Click still wants a recipient and a refund address: a placeholder NEAR
 *  mainnet name. A real deposit would name the trader's own account. */
const PLACEHOLDER = "test.near";
/** The panel prices a deposit; larger asks are refused before they reach 1Click. */
export const MAX_QUOTE_USD = 1_000_000;

/** A request the route turns down, with the status it answers. */
export class OneClickError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

interface Token {
  assetId: string;
  decimals: number;
  symbol: string;
  blockchain: string;
  price?: number;
}

// GET /tokens: about 230 entries that change slowly; asked again every five minutes
let tokens: { at: number; list: Token[] } | null = null;
async function tokenList(): Promise<Token[]> {
  if (tokens && Date.now() - tokens.at < 5 * 60_000) return tokens.list;
  const res = await fetch(`${ONECLICK}/tokens`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new OneClickError(`1Click's token list answered ${res.status}`, 502);
  const list = (await res.json()) as Token[];
  if (!Array.isArray(list)) throw new OneClickError("1Click's token list was not a list", 502);
  tokens = { at: Date.now(), list };
  return list;
}

/** The body of POST /quote for `amount` (smallest units) of `assetId` sent on its own chain, to USDC on NEAR. */
export function dryQuoteBody(assetId: string, amount: bigint, now = Date.now()) {
  return {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100, // basis points: 1%
    originAsset: assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: USDC_ON_NEAR,
    amount: amount.toString(),
    refundTo: PLACEHOLDER,
    refundType: "INTENTS",
    recipient: PLACEHOLDER,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now + 10 * 60_000).toISOString(),
  } as const;
}

const oneClickSays = (json: unknown, status: number) => {
  const m = (json as { message?: unknown } | null)?.message;
  return (typeof m === "string" && m ? `1Click: ${m}` : `1Click answered ${status}`).slice(0, 200);
};

/** POST /quote's answer, reduced to the fields the panel shows. Refuses one that wasn't a dry run. */
export function parseQuote(origin: Origin, json: unknown): DryQuote {
  const j = json as { quote?: Record<string, unknown>; quoteRequest?: { dry?: unknown; appFees?: unknown }; timestamp?: unknown } | null;
  const q = j?.quote;
  if (!q) throw new OneClickError("1Click sent no quote", 502);
  // its echo of the request must say dry: a quote that wasn't is never shown
  if (j.quoteRequest?.dry !== true) throw new OneClickError("1Click did not confirm a dry run", 502);
  const text = (k: string) => {
    if (typeof q[k] !== "string") throw new OneClickError(`1Click's quote has no ${k}`, 502);
    return q[k] as string;
  };
  const fees = j.quoteRequest.appFees;
  return {
    dry: true,
    origin,
    quote: {
      amountIn: text("amountIn"),
      amountInFormatted: text("amountInFormatted"),
      amountInUsd: text("amountInUsd"),
      amountOut: text("amountOut"),
      amountOutFormatted: text("amountOutFormatted"),
      amountOutUsd: text("amountOutUsd"),
      minAmountOut: text("minAmountOut"),
      timeEstimate: typeof q.timeEstimate === "number" ? q.timeEstimate : undefined,
      withdrawFee: typeof q.withdrawFee === "string" ? q.withdrawFee : undefined,
    },
    feeBps: Array.isArray(fees) ? fees.reduce((s: number, f) => s + (Number((f as { fee?: unknown })?.fee) || 0), 0) : null,
    timestamp: typeof j.timestamp === "string" ? j.timestamp : null,
  };
}

/** A dry-run quote for `amountText` (as typed, such as "0.1") of one of the listed origins. */
export async function dryQuote(assetId: string, amountText: string): Promise<DryQuote> {
  const origin = originOf(assetId);
  if (!origin) throw new OneClickError("Pick one of the listed assets");
  const token = (await tokenList()).find((t) => t.assetId === assetId);
  if (!token) throw new OneClickError(`1Click doesn't list ${origin.symbol} on ${origin.chain} right now`, 502);
  const raw = parseTokenAmount(amountText, token.decimals);
  if (raw === 0n) throw new OneClickError(`Enter an amount of ${origin.symbol} above zero, with at most ${token.decimals} decimal places`);
  if (token.price && Number(amountText) * token.price > MAX_QUOTE_USD) throw new OneClickError("Quotes go up to $1,000,000");
  const res = await fetch(`${ONECLICK}/quote`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(dryQuoteBody(assetId, raw)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new OneClickError(oneClickSays(json, res.status), res.status >= 500 ? 502 : 400);
  return parseQuote(origin, json);
}

/** GET /status's answer, reduced to the documented fields the message uses. */
export function parseStatus(json: unknown, list: Pick<Token, "assetId" | "symbol">[] = []): StatusAnswer {
  const j = json as { status?: unknown; updatedAt?: unknown; swapDetails?: Record<string, unknown>; quoteResponse?: { quoteRequest?: Record<string, unknown> } };
  if (typeof j?.status !== "string") throw new OneClickError("1Click sent no status", 502);
  const s = j.swapDetails ?? {};
  const r = j.quoteResponse?.quoteRequest ?? {};
  const str = (x: unknown) => (typeof x === "string" && x.length > 0 && x.length <= 200 ? x : undefined);
  const symbol = (id: unknown) => list.find((t) => t.assetId === id)?.symbol;
  return {
    status: j.status.slice(0, 40),
    updatedAt: str(j.updatedAt),
    amountOutFormatted: str(s.amountOutFormatted),
    depositedAmountFormatted: str(s.depositedAmountFormatted),
    refundedAmountFormatted: str(s.refundedAmountFormatted),
    refundReason: str(s.refundReason),
    recipient: str(r.recipient),
    refundTo: str(r.refundTo),
    refundType: str(r.refundType),
    originSymbol: symbol(r.originAsset),
    destinationSymbol: symbol(r.destinationAsset),
  };
}

/** Where a 1Click swap is, by its deposit address (and memo, on chains that use one). Reads only. */
export async function depositStatus(address: string, memo?: string): Promise<StatusAnswer> {
  if (!validDepositAddress(address)) throw new OneClickError("That doesn't look like a deposit address");
  if (memo && !validMemo(memo)) throw new OneClickError("That memo has characters a deposit memo doesn't use");
  const url = new URL(`${ONECLICK}/status`);
  url.searchParams.set("depositAddress", address);
  if (memo) url.searchParams.set("depositMemo", memo);
  const res = await fetch(url, { headers: { "User-Agent": HEADERS["User-Agent"] }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (res.status === 404) return { status: NOT_FOUND };
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new OneClickError(oneClickSays(json, res.status), res.status >= 500 ? 502 : 400);
  return parseStatus(json, await tokenList().catch(() => []));
}

// a few asks a minute from one visitor: the panel needs one per click, and 1Click turns busy callers away
const RATE = { max: 20, windowMs: 60_000 };
const recent = new Map<string, number[]>();
export function underLimit(who: string, now = Date.now()): boolean {
  const ts = (recent.get(who) ?? []).filter((t) => now - t < RATE.windowMs);
  const ok = ts.length < RATE.max;
  if (ok) ts.push(now);
  recent.set(who, ts);
  if (recent.size > 1000) for (const [k, v] of recent) if (!v.some((t) => now - t < RATE.windowMs)) recent.delete(k);
  return ok;
}
/** The visitor, for the rate limit: the first forwarded address on a host such as Vercel, else this machine. */
export const visitor = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
