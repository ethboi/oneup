import { test } from "node:test";
import assert from "node:assert/strict";
import type { Deployment } from "@oneup/sdk";
import { MAX_SWAP_USDC, checkFill } from "../src/lib/server/intents.ts";

const d = {
  contracts: { usdc: "usdc.test.near", house: "house.test.near" },
  intents: {
    assets: [
      { token: "usdc-sol.poa.test.near", chain: "Solana", symbol: "USDC", decimals: 6 },
      { token: "eth.poa.test.near", chain: "Ethereum", symbol: "ETH", decimals: 18 },
    ],
  },
} as unknown as Deployment;
const ETH = "eth.poa.test.near";
const usdc = "nep141:usdc.test.near";
const eth = `nep141:${ETH}`;
const OUT = 100_000_000n; // 100 USDC
const NEED = 40_000_000_000_000_000n; // 0.04 ETH

const withdraw = (account = "demo.test.near") => ({
  intent: "ft_withdraw",
  token: "usdc.test.near",
  receiver_id: "house.test.near",
  amount: OUT.toString(),
  msg: JSON.stringify({ for: { account_id: account } }),
});
const message = (diff: Record<string, string>, extra: object[] = [withdraw()], signer = "demo.test.near") =>
  JSON.stringify({ signer_id: signer, intents: [{ intent: "token_diff", diff }, ...extra] });
const good = { [eth]: `-${NEED}`, [usdc]: OUT.toString() };

test("checkFill accepts the app's swap", () => {
  assert.equal(checkFill(d, message(good), ETH, OUT, NEED), NEED);
  const open = { ...withdraw(), msg: JSON.stringify({ open: { market_id: "NEAR-USD", account_id: "demo.test.near" } }) };
  assert.equal(checkFill(d, message(good, [open]), ETH, OUT, NEED), NEED);
  // within the 30 bp fee of the quote: the price moved a little
  const low = (NEED * 9_971n) / 10_000n;
  assert.equal(checkFill(d, message({ ...good, [eth]: `-${low}` }), ETH, OUT, NEED), low);
});

test("checkFill rejects", () => {
  const bad = (msg: string, out = OUT, token = ETH) => assert.throws(() => checkFill(d, msg, token, out, NEED));
  bad(message({ [eth]: "0", [usdc]: "0" }), 0n); // usdcOut 0
  bad(message({ [eth]: `-${NEED}`, [usdc]: "-1" }), -1n);
  bad(message({ [eth]: `-${NEED}`, [usdc]: (MAX_SWAP_USDC + 1n).toString() }), MAX_SWAP_USDC + 1n);
  bad(message({ [eth]: NEED.toString(), [usdc]: OUT.toString() })); // the user receives the token too
  bad(message({ [eth]: "0", [usdc]: OUT.toString() }));
  bad(message({ ...good, "nep141:oneup.test.near": "-1" })); // an extra key
  bad(message({ [usdc]: OUT.toString() })); // missing the token
  bad(message(good, [{ intent: "token_diff", diff: good }, withdraw()])); // two token_diffs
  bad(message({ ...good, [usdc]: (OUT + 1n).toString() })); // more USDC than quoted
  bad(message({ ...good, [eth]: `-${(NEED * 9_969n) / 10_000n}` })); // below quote less fee
  bad(message(good), OUT, "doge.poa.test.near"); // unknown token
  bad(message(good, [withdraw("victim.test.near")])); // deposit for someone else
  bad(message(good, [{ intent: "transfer", receiver_id: "x.test.near", tokens: {} }]));
});
