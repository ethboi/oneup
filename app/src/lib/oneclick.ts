// NEAR Intents' 1Click API, read only: dry-run quotes for bringing an asset from another chain into USDC on NEAR,
// and the status of a 1Click deposit address. Nothing here sends or signs anything. 1Click has no testnet, so the
// quotes are mainnet quotes, shown beside a testnet app and never executed.
//
// Endpoints and fields as documented (docs.near-intents.org, 1Click API: "Making a Request" and the OpenAPI file at
// https://1click.chaindefuser.com/docs/v0/openapi.yaml, read 11 Nov 2026) and as a real dry-run answer showed them.
// Shared by the server route (lib/server/oneclick.ts) and the panel (components/CrossChain.tsx).

export const ONECLICK = "https://1click.chaindefuser.com/v0";

/** USDC on NEAR mainnet (Circle's NEP-141), what a deposit into OneUp would arrive as. 6 decimals. */
export const USDC_ON_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_DECIMALS = 6;

/** What the panel offers to quote from. Each `assetId` is from 1Click's GET /tokens (11 Nov 2026); the server
 *  still looks each one up there for its decimals and list price, and quotes nothing else. */
export const ORIGINS = [
  { assetId: "nep141:eth.omft.near", symbol: "ETH", chain: "Ethereum", example: "0.1" },
  { assetId: "nep141:btc.omft.near", symbol: "BTC", chain: "Bitcoin", example: "0.005" },
  { assetId: "nep141:sol.omft.near", symbol: "SOL", chain: "Solana", example: "2" },
  { assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", symbol: "USDC", chain: "Ethereum", example: "500" },
  { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", symbol: "USDC", chain: "Arbitrum", example: "500" },
  { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", symbol: "USDC", chain: "Base", example: "500" },
  { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", symbol: "USDC", chain: "Solana", example: "500" },
  { assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", symbol: "USDT", chain: "Ethereum", example: "500" },
  { assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", symbol: "USDT", chain: "Tron", example: "500" },
  { assetId: "nep141:wrap.near", symbol: "wNEAR", chain: "NEAR", example: "100" },
] as const;
export type Origin = (typeof ORIGINS)[number];
export const originOf = (assetId: string): Origin | undefined => ORIGINS.find((o) => o.assetId === assetId);

/** The quote fields the panel uses, from POST /quote's `quote` (amounts are strings, USD values too). */
export interface QuoteFields {
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  timeEstimate?: number;
  withdrawFee?: string;
}

/** What the server route answers for a dry-run quote. */
export interface DryQuote {
  dry: true;
  origin: Origin;
  quote: QuoteFields;
  /** Fees 1Click named in the request it echoes back (`quoteRequest.appFees`), in basis points, summed. */
  feeBps: number | null;
  /** When 1Click made the quote (ISO). */
  timestamp: string | null;
}

/** USDC smallest units (6 decimals) as a plain number of dollars, for display. */
const usdc = (raw: string) => Number(raw) / 10 ** USDC_DECIMALS;

/** The numbers a person reads: what arrives, the least it can be, what the move costs, and how long it takes. */
export function summarize(q: Pick<DryQuote, "quote" | "feeBps">) {
  const inUsd = Number(q.quote.amountInUsd);
  const outUsd = Number(q.quote.amountOutUsd);
  const cost = Number.isFinite(inUsd) && Number.isFinite(outUsd) ? inUsd - outUsd : null;
  const withdraw = q.quote.withdrawFee && q.quote.withdrawFee !== "0" ? usdc(q.quote.withdrawFee) : null;
  return {
    receive: Number(q.quote.amountOutFormatted),
    atLeast: usdc(q.quote.minAmountOut),
    inUsd,
    outUsd,
    /** Value in less value out, both at 1Click's list prices: the spread and every fee together. */
    cost,
    costPct: cost !== null && inUsd > 0 ? (cost / inUsd) * 100 : null,
    feePct: q.feeBps === null ? null : q.feeBps / 100,
    withdrawFee: withdraw,
    seconds: typeof q.quote.timeEstimate === "number" && q.quote.timeEstimate >= 0 ? q.quote.timeEstimate : null,
  };
}

/** "about 45 seconds", "about 3 minutes". */
export function aboutTime(s: number): string {
  if (s < 90) return `about ${Math.max(1, Math.round(s))} second${Math.round(s) === 1 ? "" : "s"}`;
  const m = Math.round(s / 60);
  return m < 90 ? `about ${m} minutes` : `about ${Math.round(m / 60)} hours`;
}

// ---- status of a deposit address (GET /status) ----

/** Every status GET /status can answer with. */
export const STATUSES = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS", "INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED"] as const;
export type OneClickStatus = (typeof STATUSES)[number];
/** Ours, not 1Click's: it answered 404, so it has no swap at that address. */
export const NOT_FOUND = "NOT_FOUND";

/** The status route's answer: the documented fields the message uses, nothing else. */
export interface StatusAnswer {
  status: string;
  updatedAt?: string;
  /** From `swapDetails`. */
  amountOutFormatted?: string;
  depositedAmountFormatted?: string;
  refundedAmountFormatted?: string;
  refundReason?: string;
  /** From `quoteResponse.quoteRequest`, and the symbols of its assets when 1Click lists them. */
  recipient?: string;
  refundTo?: string;
  refundType?: string;
  originSymbol?: string;
  destinationSymbol?: string;
}

export type Tone = "wait" | "good" | "warn" | "bad";
export interface StatusMessage {
  title: string;
  /** Where the funds are now, in plain words. */
  text: string;
  tone: Tone;
  /** Nothing more will happen at this address. */
  final: boolean;
}

/** "0.1 ETH", or null when 1Click gave no amount (or zero). */
const amount = (x: string | undefined, symbol: string | undefined) => (x && Number(x) > 0 ? `${x}${symbol ? ` ${symbol}` : ""}` : null);

/** A 1Click status in plain words, saying where the funds are. Unknown statuses say so instead of guessing. */
export function statusMessage(a: StatusAnswer): StatusMessage {
  const out = amount(a.amountOutFormatted, a.destinationSymbol);
  const deposited = amount(a.depositedAmountFormatted, a.originSymbol);
  const refunded = amount(a.refundedAmountFormatted, a.originSymbol);
  const refundPlace =
    a.refundType === "INTENTS" ? " as a NEAR Intents balance" : a.refundType === "ORIGIN_CHAIN" ? " on the chain they came from" : "";
  switch (a.status) {
    case "PENDING_DEPOSIT":
      return { title: "Waiting for the deposit", text: "Nothing has arrived at this address yet, so no funds have moved.", tone: "wait", final: false };
    case "KNOWN_DEPOSIT_TX":
      return {
        title: "Deposit seen",
        text: "1Click has seen a transaction sending funds to this address and is waiting for it to confirm. Nothing has been swapped yet.",
        tone: "wait",
        final: false,
      };
    case "PROCESSING":
      return { title: "Swapping", text: "The deposit arrived and the swap is running. 1Click holds the funds until it delivers them.", tone: "wait", final: false };
    case "SUCCESS":
      return {
        title: "Delivered",
        text: `The swap finished and ${out ?? "the tokens"} went to the recipient${a.recipient ? `, ${a.recipient}` : ""}.`,
        tone: "good",
        final: true,
      };
    case "INCOMPLETE_DEPOSIT":
      return {
        title: "Deposit too small",
        text: `Less arrived than the quote needs${deposited ? ` (${deposited})` : ""}, so nothing has been swapped. The funds wait with 1Click: if the rest doesn't arrive before the quote's deadline, they are refunded to the refund address${a.refundTo ? `, ${a.refundTo}` : ""}.`,
        tone: "warn",
        final: false,
      };
    case "REFUNDED":
      return {
        title: "Refunded",
        text: `The swap didn't go through, and 1Click sent ${refunded ?? "the funds"} back to the refund address${a.refundTo ? `, ${a.refundTo}` : ""}${refundPlace}. Nothing went to the recipient.${a.refundReason ? ` Reason given: ${a.refundReason}.` : ""}`,
        tone: "warn",
        final: true,
      };
    case "FAILED":
      return {
        title: "Failed",
        text: "The swap stopped with an error. 1Click reports neither a delivery nor a refund, so the funds are still with 1Click, not back with you. Keep the deposit address and ask 1Click's support; the NEAR Intents Explorer shows what happened at it.",
        tone: "bad",
        final: true,
      };
    case NOT_FOUND:
      return { title: "Not found", text: "1Click has no swap at this address. Check it was copied whole. A dry-run quote never has a deposit address.", tone: "warn", final: true };
    default:
      return {
        title: "Unknown status",
        text: `1Click answered "${String(a.status).slice(0, 40)}", a status OneUp doesn't know. The NEAR Intents Explorer shows what happened at this address.`,
        tone: "warn",
        final: false,
      };
  }
}

/** A deposit address as 1Click hands them out: an EVM, Solana, Bitcoin, Tron or NEAR address. Loose on purpose, but
 *  never anything that could change the request to 1Click. */
export const validDepositAddress = (s: string) => /^[A-Za-z0-9._:-]{8,128}$/.test(s);
/** A deposit memo, for the chains that need one with the address. */
export const validMemo = (s: string) => /^[A-Za-z0-9 _.:-]{1,128}$/.test(s);
