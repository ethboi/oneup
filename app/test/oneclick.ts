import { test } from "node:test";
import assert from "node:assert/strict";
import { NOT_FOUND, ORIGINS, STATUSES, USDC_ON_NEAR, aboutTime, originOf, statusMessage, summarize, validDepositAddress, validMemo } from "../src/lib/oneclick.ts";
import { OneClickError, dryQuoteBody, parseQuote, parseStatus } from "../src/lib/server/oneclick.ts";

// A real dry-run answer from POST https://1click.chaindefuser.com/v0/quote (0.1 ETH on Ethereum to USDC on NEAR,
// 11 Nov 2026), trimmed of the signature.
const REAL = {
  quote: {
    amountIn: "100000000000000000", amountInFormatted: "0.1", amountInUsd: "208.719000000000", minAmountIn: "100000000000000000",
    amountOut: "208372736", amountOutFormatted: "208.372736", amountOutUsd: "208.289803651072", minAmountOut: "206289008",
    timeEstimate: 45, refundFee: "0", withdrawFee: "0",
  },
  quoteRequest: {
    dry: true, depositMode: "SIMPLE", swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: "nep141:eth.omft.near", depositType: "ORIGIN_CHAIN",
    destinationAsset: USDC_ON_NEAR, amount: "100000000000000000", refundTo: "test.near", refundType: "INTENTS", recipient: "test.near",
    recipientType: "DESTINATION_CHAIN", deadline: "2026-11-11T18:49:20.000Z", confidentiality: "public", quoteWaitingTimeMs: 0, insured: false,
    appFees: [{ recipient: "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd", fee: 20 }],
  },
  timestamp: "2026-11-11T18:39:20.904Z",
  correlationId: "78e8f112-4ce6-49d7-ac7b-62487fe750bd",
};
const ETH = originOf("nep141:eth.omft.near")!;

test("1click: every quote request is a dry run, from the origin chain into USDC on NEAR", () => {
  const body = dryQuoteBody(ETH.assetId, 10n ** 17n, Date.parse("2026-11-11T18:00:00Z"));
  assert.equal(body.dry, true);
  assert.equal(body.swapType, "EXACT_INPUT");
  assert.equal(body.originAsset, ETH.assetId);
  assert.equal(body.depositType, "ORIGIN_CHAIN");
  assert.equal(body.destinationAsset, USDC_ON_NEAR);
  assert.equal(body.amount, "100000000000000000");
  assert.equal(body.deadline, "2026-11-11T18:10:00.000Z");
  // only the documented fields go to 1Click
  assert.deepEqual(Object.keys(body).sort(), ["amount", "deadline", "depositType", "destinationAsset", "dry", "originAsset", "recipient", "recipientType", "refundTo", "refundType", "slippageTolerance", "swapType"]);
});

test("1click: a real dry-run answer reads as what arrives, the least it can be, the cost and the time", () => {
  const q = parseQuote(ETH, REAL);
  assert.equal(q.dry, true);
  assert.equal(q.feeBps, 20);
  assert.equal(q.timestamp, "2026-11-11T18:39:20.904Z");
  assert.ok(!("depositAddress" in q.quote), "a dry run shows no deposit address");
  const s = summarize(q);
  assert.equal(s.receive, 208.372736);
  assert.equal(s.atLeast, 206.289008);
  assert.ok(Math.abs(s.cost! - 0.429196) < 1e-6, String(s.cost));
  assert.ok(Math.abs(s.costPct! - 0.20564) < 1e-4, String(s.costPct));
  assert.equal(s.feePct, 0.2);
  assert.equal(s.withdrawFee, null, "a zero withdrawal fee isn't shown");
  assert.equal(s.seconds, 45);
  assert.equal(aboutTime(45), "about 45 seconds");
  assert.equal(aboutTime(600), "about 10 minutes");
});

test("1click: an answer that isn't a dry run, or has no quote, is refused", () => {
  assert.throws(() => parseQuote(ETH, { ...REAL, quoteRequest: { ...REAL.quoteRequest, dry: false } }), OneClickError);
  assert.throws(() => parseQuote(ETH, { ...REAL, quoteRequest: undefined }), OneClickError);
  assert.throws(() => parseQuote(ETH, { message: "Amount is too low" }), OneClickError);
  assert.throws(() => parseQuote(ETH, { ...REAL, quote: { ...REAL.quote, amountOut: 208 } }), OneClickError);
  assert.throws(() => parseQuote(ETH, null), OneClickError);
});

test("1click: the listed origins are distinct and none is USDC on NEAR itself", () => {
  assert.equal(new Set(ORIGINS.map((o) => o.assetId)).size, ORIGINS.length);
  assert.ok(ORIGINS.every((o) => o.assetId !== USDC_ON_NEAR && /^nep141:/.test(o.assetId) && Number(o.example) > 0));
  assert.equal(originOf("nep141:not-listed.near"), undefined);
});

test("1click status: every status 1Click documents has its own plain message", () => {
  const titles = new Set<string>();
  for (const status of STATUSES) {
    const m = statusMessage({ status });
    assert.ok(m.title && m.text, status);
    assert.ok(!/[A-Z]{4,}_/.test(m.text), `${status} is in plain words`);
    titles.add(m.title);
  }
  assert.equal(titles.size, STATUSES.length);
  assert.deepEqual(STATUSES.filter((s) => statusMessage({ status: s }).final), ["SUCCESS", "REFUNDED", "FAILED"]);
  assert.equal(statusMessage({ status: "PENDING_DEPOSIT" }).tone, "wait");
  assert.equal(statusMessage({ status: "SUCCESS" }).tone, "good");
});

test("1click status: REFUNDED says the funds went back, how much and to whom", () => {
  const m = statusMessage({ status: "REFUNDED", refundedAmountFormatted: "0.1", originSymbol: "ETH", refundTo: "0xabc", refundType: "ORIGIN_CHAIN", refundReason: "PARTIAL_DEPOSIT" });
  assert.equal(m.title, "Refunded");
  assert.match(m.text, /sent 0\.1 ETH back to the refund address, 0xabc on the chain they came from/);
  assert.match(m.text, /Nothing went to the recipient/);
  assert.match(m.text, /PARTIAL_DEPOSIT/);
  // without the details it still says where the funds went
  assert.match(statusMessage({ status: "REFUNDED" }).text, /sent the funds back to the refund address/);
  assert.match(statusMessage({ status: "REFUNDED", refundType: "INTENTS", refundTo: "a.near" }).text, /a\.near as a NEAR Intents balance/);
});

test("1click status: FAILED says the funds were neither delivered nor refunded", () => {
  const m = statusMessage({ status: "FAILED" });
  assert.equal(m.tone, "bad");
  assert.match(m.text, /neither a delivery nor a refund/);
  assert.match(m.text, /still with 1Click/);
  assert.match(m.text, /support/);
});

test("1click status: delivery, a short deposit, an unknown address and an unknown status", () => {
  assert.match(statusMessage({ status: "SUCCESS", amountOutFormatted: "208.37", destinationSymbol: "USDC", recipient: "alice.near" }).text, /208\.37 USDC went to the recipient, alice\.near/);
  const short = statusMessage({ status: "INCOMPLETE_DEPOSIT", depositedAmountFormatted: "0.05", originSymbol: "ETH" });
  assert.match(short.text, /\(0\.05 ETH\)/);
  assert.match(short.text, /refunded/);
  assert.equal(short.final, false);
  assert.equal(statusMessage({ status: NOT_FOUND }).title, "Not found");
  const odd = statusMessage({ status: "SOMETHING_NEW" });
  assert.equal(odd.title, "Unknown status");
  assert.match(odd.text, /SOMETHING_NEW/);
  // a zero amount reads as no amount
  assert.match(statusMessage({ status: "REFUNDED", refundedAmountFormatted: "0" }).text, /sent the funds back/);
});

test("1click status: the answer keeps only documented fields and names the assets", () => {
  const a = parseStatus(
    {
      correlationId: "x",
      status: "REFUNDED",
      updatedAt: "2026-11-11T18:00:00.000Z",
      swapDetails: { intentHashes: [], nearTxHashes: [], originChainTxHashes: [], destinationChainTxHashes: [], refundedAmountFormatted: "0.1", refundReason: "PARTIAL_DEPOSIT", secret: "no" },
      quoteResponse: { quoteRequest: { originAsset: ETH.assetId, destinationAsset: USDC_ON_NEAR, refundTo: "0xabc", refundType: "ORIGIN_CHAIN", recipient: "alice.near" } },
    },
    [{ assetId: ETH.assetId, symbol: "ETH" }, { assetId: USDC_ON_NEAR, symbol: "USDC" }],
  );
  assert.deepEqual(a, {
    status: "REFUNDED", updatedAt: "2026-11-11T18:00:00.000Z", amountOutFormatted: undefined, depositedAmountFormatted: undefined,
    refundedAmountFormatted: "0.1", refundReason: "PARTIAL_DEPOSIT", recipient: "alice.near", refundTo: "0xabc", refundType: "ORIGIN_CHAIN",
    originSymbol: "ETH", destinationSymbol: "USDC",
  });
  assert.throws(() => parseStatus({ message: "nope" }), OneClickError);
});

test("1click status: addresses and memos that could change the request are refused", () => {
  for (const ok of ["0x76b4c56085ED136a8744D52bE956396624a730E8", "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", "3k2oPZbqZ2Q8D2Ni8mLhQUyKaoLYtU5WkxPjHvsZwkyw", "alice.near"])
    assert.ok(validDepositAddress(ok), ok);
  for (const bad of ["", "short", "0xabc&depositMemo=1", "a b c d e f g h", "../../tokens?x=1", "x".repeat(129)]) assert.equal(validDepositAddress(bad), false, bad);
  assert.ok(validMemo("1111111"));
  assert.equal(validMemo("a&b"), false);
});
