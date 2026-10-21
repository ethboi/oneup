// Server side of NEAR Intents (D-21): the simulated bridge and OneUp's solver. Localnet only: the bridge
// is the root account (it holds the PoA factory's depositer role) and the solver's key is in
// localnet.json. Intents are signed with the official @defuse-protocol/intents-sdk.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createIntentSignerNEP413, VersionedNonceBuilder } from "@defuse-protocol/intents-sdk";
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { normalizePrice, type BridgedAsset, type Deployment } from "@oneup/sdk";

export function deployment(): Deployment {
  return JSON.parse(readFileSync(resolve(process.cwd(), "../localnet.json"), "utf8"));
}

const provider = (d: Deployment) => new JsonRpcProvider({ url: d.rpcUrl });

export function asset(d: Deployment, token: string): BridgedAsset {
  const a = d.intents?.assets.find((x) => x.token === token);
  if (!a) throw new Error(`Unknown bridged asset ${token}`);
  return a;
}

/** The simulated bridge: mints `amount` of a bridged asset into the Verifier for `account`, as a real
 *  bridge would after seeing a deposit on the source chain. */
export async function bridgeIn(account: string, token: string, amount: bigint) {
  const d = deployment();
  asset(d, token);
  const root = new Account(d.owner.id, provider(d), d.owner.key as KeyPairString);
  await root.callFunction({
    contractId: d.intents!.poa,
    methodName: "ft_deposit",
    args: { token: token.split(".")[0], owner_id: d.intents!.verifier, amount: amount.toString(), msg: account },
    deposit: nearToYocto("0.004"),
    gas: teraToGas("100"),
  });
}

/** Spreads the solver charges: 5 bps on stablecoins, 30 bps on ETH. */
const FEE_BPS = (a: BridgedAsset) => (a.symbol === "USDC" ? 5n : 30n);

/** How much of `token` buys `usdcOut` USDC (6 decimals), from the oracle's ETH price where needed. */
export async function quoteExactOut(token: string, usdcOut: bigint): Promise<{ amountIn: bigint; price: number }> {
  const d = deployment();
  const a = asset(d, token);
  let usdPerUnit = 1;
  if (a.symbol !== "USDC") {
    const feed = d.markets.find((m) => m.id === `${a.symbol}-USD`)!.feedId;
    const p = (await provider(d).callFunction({ contractId: d.contracts.oracle, method: "get_price_unsafe", args: { price_identifier: feed } })) as {
      price: string;
      expo: number;
    } | null;
    if (!p) throw new Error(`No ${a.symbol} price`);
    usdPerUnit = Number(normalizePrice(BigInt(p.price), p.expo)) / 1e8;
  }
  // amountIn = usdcOut / price / (1 - fee), in the asset's decimals, rounded up
  const scale = 10n ** BigInt(a.decimals);
  const priceMicro = BigInt(Math.floor(usdPerUnit * 1e6)); // USDC (6 dp) per whole unit
  const gross = (usdcOut * 10_000n) / (10_000n - FEE_BPS(a)) + 1n;
  const amountIn = (gross * scale + priceMicro - 1n) / priceMicro;
  return { amountIn, price: usdPerUnit };
}

interface MultiPayload {
  standard: string;
  payload: { message: string; nonce: string; recipient: string };
  public_key: string;
  signature: string;
}

/**
 * Fills a user's signed swap: checks it pays `amountIn` of `token` for exactly the quoted USDC, signs the
 * mirror token_diff as the solver and executes both in one execute_intents call.
 */
export async function fill(user: MultiPayload, token: string, usdcOut: bigint) {
  const d = deployment();
  const i = d.intents!;
  const usdcId = `nep141:${d.contracts.usdc}`;
  const tokenId = `nep141:${token}`;
  const msg = JSON.parse(user.payload.message) as { signer_id: string; intents: { intent: string; diff?: Record<string, string> }[] };
  const diff = msg.intents.find((x) => x.intent === "token_diff")?.diff;
  if (!diff || BigInt(diff[usdcId] ?? "0") !== usdcOut) throw new Error("The intent doesn't match the quote");
  const amountIn = -BigInt(diff[tokenId] ?? "0");
  const { amountIn: needed } = await quoteExactOut(token, usdcOut);
  // the price may have moved since the quote: allow 1%
  if (amountIn * 100n < needed * 99n) throw new Error("Price moved: ask for a new quote");

  const kp = KeyPair.fromString(i.solver.key as KeyPairString);
  const signer = createIntentSignerNEP413({
    accountId: i.solver.id,
    signMessage: (_p, hash) => ({
      publicKey: kp.getPublicKey().toString(),
      signature: Buffer.from(kp.sign(hash).signature).toString("base64"),
    }),
  });
  const solverAccount = new Account(i.solver.id, provider(d), i.solver.key as KeyPairString);
  const salt = (await provider(d).callFunction({ contractId: i.verifier, method: "current_salt", args: {} })) as string;
  const deadline = new Date(Date.now() + 120_000);
  const mine = await signer.signIntent({
    signer_id: i.solver.id,
    verifying_contract: i.verifier,
    deadline: deadline.toISOString(),
    nonce: VersionedNonceBuilder.encodeNonce(Buffer.from(salt, "hex"), deadline),
    intents: [{ intent: "token_diff", diff: { [usdcId]: (-usdcOut).toString(), [tokenId]: amountIn.toString() } }],
  } as never);
  // the solver's side first, so the USDC is there when the user's withdrawal runs
  const out = await solverAccount.signAndSendTransaction({
    receiverId: i.verifier,
    actions: [
      actions.functionCall("execute_intents", { signed: [mine, user] }, teraToGas("300"), 0n),
    ],
  });
  const failed = out.receipts_outcome.find((r) => typeof r.outcome.status === "object" && "Failure" in r.outcome.status);
  if (failed) throw new Error(JSON.stringify((failed.outcome.status as { Failure: unknown }).Failure).slice(0, 300));
  const logs = out.receipts_outcome.flatMap((r) => r.outcome.logs);
  return { tx: out.transaction.hash, logs };
}
