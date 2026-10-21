// Server side of NEAR Intents (D-21): the simulated bridge and OneUp's solver. Localnet only (deployment()
// checks): the bridge is the root account (it holds the PoA factory's depositer role) and the solver's key
// is in localnet.json. Intents are signed with the official @defuse-protocol/intents-sdk.

import { createIntentSignerNEP413, VersionedNonceBuilder } from "@defuse-protocol/intents-sdk";
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { normalizePrice, type BridgedAsset, type Deployment } from "@oneup/sdk";
import { deployment } from "./localnet";

export { deployment };

const provider = (d: Deployment) => new JsonRpcProvider({ url: d.rpcUrl });

export function asset(d: Deployment, token: string): BridgedAsset {
  const a = d.intents?.assets.find((x) => x.token === token);
  if (!a) throw new Error(`Unknown bridged asset ${token}`);
  return a;
}

/** Most the bridge mints per call: 100,000 of a stablecoin, 50 of anything else, in whole tokens. */
export const MAX_BRIDGE = (a: BridgedAsset) => (a.symbol === "USDC" ? 100_000n : 50n) * 10n ** BigInt(a.decimals);

/** Most USDC (6 decimals) one swap may buy. */
export const MAX_SWAP_USDC = 100_000n * 1_000_000n;

/** The simulated bridge: mints `amount` of a bridged asset into the Verifier for `account`, as a real
 *  bridge would after seeing a deposit on the source chain. */
export async function bridgeIn(account: string, token: string, amount: bigint) {
  const d = deployment();
  const a = asset(d, token);
  if (amount <= 0n || amount > MAX_BRIDGE(a)) throw new Error(`Bridge between 0 and ${MAX_BRIDGE(a) / 10n ** BigInt(a.decimals)} ${a.symbol}`);
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
export const FEE_BPS = (a: BridgedAsset) => (a.symbol === "USDC" ? 5n : 30n);

/** How much of `token` buys `usdcOut` USDC (6 decimals), from the oracle's ETH price where needed. */
export async function quoteExactOut(token: string, usdcOut: bigint): Promise<{ amountIn: bigint; price: number }> {
  if (usdcOut <= 0n || usdcOut > MAX_SWAP_USDC) throw new Error("Swap between 0 and 100,000 USDC");
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

type Intent = { intent: string; diff?: Record<string, string>; msg?: string };

/** The account a deposit or open message to the house is for. */
const msgAccount = (msg: string) => {
  const m = JSON.parse(msg) as { for?: { account_id?: string }; open?: { account_id?: string } };
  return m.for?.account_id ?? m.open?.account_id;
};

/**
 * Checks a user's signed swap message against the quote: exactly one token_diff paying `token` for exactly
 * `usdcOut` USDC, at least `needed` less the solver's fee (the price may have moved since the quote), and
 * only ft_withdraws for the signer's own account besides. Returns what the user pays.
 */
export function checkFill(d: Deployment, message: string, token: string, usdcOut: bigint, needed: bigint): bigint {
  const a = asset(d, token);
  if (usdcOut <= 0n || usdcOut > MAX_SWAP_USDC) throw new Error("Swap between 0 and 100,000 USDC");
  const usdcId = `nep141:${d.contracts.usdc}`;
  const tokenId = `nep141:${a.token}`;
  const msg = JSON.parse(message) as { signer_id: string; intents: Intent[] };
  const diffs = msg.intents.filter((x) => x.intent === "token_diff");
  const diff = diffs.length === 1 ? diffs[0].diff : undefined;
  const exact = Object.keys(diff ?? {}).sort().join() === [usdcId, tokenId].sort().join();
  if (!diff || !exact || BigInt(diff[usdcId]) !== usdcOut) throw new Error("The intent doesn't match the quote");
  const amountIn = -BigInt(diff[tokenId]);
  if (amountIn <= 0n) throw new Error("The intent doesn't match the quote");
  for (const x of msg.intents) {
    if (x.intent === "token_diff") continue;
    if (x.intent !== "ft_withdraw" || (x.msg !== undefined && msgAccount(x.msg) !== msg.signer_id)) throw new Error("The solver only fills a swap and your own deposit");
  }
  if (amountIn * 10_000n < needed * (10_000n - FEE_BPS(a))) throw new Error("Price moved: ask for a new quote");
  return amountIn;
}

/** One fill at a time: the solver's key has one nonce. */
const g = globalThis as unknown as { __oneupFills?: Promise<unknown> };
function serial<T>(f: () => Promise<T>): Promise<T> {
  const p = (g.__oneupFills ?? Promise.resolve()).then(f, f);
  g.__oneupFills = p.catch(() => {});
  return p;
}

/**
 * Fills a user's signed swap: checks it pays `amountIn` of `token` for exactly the quoted USDC, signs the
 * mirror token_diff as the solver and executes both in one execute_intents call.
 */
export function fill(user: MultiPayload, token: string, usdcOut: bigint) {
  return serial(() => fillNow(user, token, usdcOut));
}

async function fillNow(user: MultiPayload, token: string, usdcOut: bigint) {
  const d = deployment();
  const i = d.intents!;
  const usdcId = `nep141:${d.contracts.usdc}`;
  const tokenId = `nep141:${token}`;
  const { amountIn: needed } = await quoteExactOut(token, usdcOut);
  const amountIn = checkFill(d, user.payload.message, token, usdcOut, needed);

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
