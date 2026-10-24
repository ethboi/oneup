// Paying from another chain with NEAR Intents (D-21), browser side. The flow:
//   1. the simulated bridge mints the bridged asset into the Verifier for you (/api/intents/bridge);
//   2. this device's key is registered with the Verifier, once (add_public_key);
//   3. the solver quotes the asset needed for the USDC (/api/intents/quote);
//   4. you sign ONE intent: swap the asset for USDC, then withdraw the USDC to the house with a message
//      that credits you or opens your trade (signed with the official @defuse-protocol/intents-sdk);
//   5. the solver signs the other side and executes both (/api/intents/fill).

import { createIntentSignerNEP413, VersionedNonceBuilder } from "@defuse-protocol/intents-sdk";
import type { AppDeployment } from "./app-config";
import { KeyPair, teraToGas, type Account, type KeyPairString } from "near-api-js";
import type { BridgedAsset, OneUp, Side } from "@oneup/sdk";

export type Then =
  | { kind: "deposit" }
  | { kind: "open"; market_id: string; side: Side; margin: bigint; leverage: number; takeProfit?: bigint | null; stopLoss?: bigint | null };

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `${path} failed`);
  return j as T;
}

/** Balances held in the Verifier (NEP-245), by token contract. */
export async function intentsBalances(o: OneUp, d: AppDeployment, account: string): Promise<Record<string, bigint>> {
  const i = d.intents;
  if (!i) return {};
  const tokens = [...i.assets.map((a) => a.token), d.contracts.usdc];
  const out = await o.view<string[]>(i.verifier, "mt_batch_balance_of", { account_id: account, token_ids: tokens.map((t) => `nep141:${t}`) });
  return Object.fromEntries(tokens.map((t, k) => [t, BigInt(out[k] ?? "0")]));
}

/** Registers the account's key with the Verifier if it isn't yet (named accounts sign with registered keys). */
async function ensureKey(o: OneUp, d: AppDeployment, main: Account, key: KeyPair) {
  const public_key = key.getPublicKey().toString();
  const has = await o.view<boolean>(d.intents!.verifier, "has_public_key", { account_id: main.accountId, public_key });
  if (!has) await main.callFunction({ contractId: d.intents!.verifier, methodName: "add_public_key", args: { public_key }, deposit: 1n, gas: teraToGas("30") });
}

/**
 * Pays `usdc` into the house from a bridged asset in one signed intent, then deposits it or opens a
 * trade. `onStep` reports progress for the UI.
 */
export async function payFromChain(opts: {
  o: OneUp;
  d: AppDeployment;
  main: Account | null;
  keyString: string | null;
  asset: BridgedAsset;
  usdc: bigint;
  then: Then;
  onStep?: (s: string) => void;
}) {
  const { o, d, main, asset, usdc, then } = opts;
  if (d.network !== "localnet" || !main || !opts.keyString) throw new Error("Simulated bridge deposits are available only in the local demo");
  const step = opts.onStep ?? (() => {});
  const i = d.intents!;
  const key = KeyPair.fromString(opts.keyString as KeyPairString);

  step("Quote from the solver");
  const { amountIn } = await post<{ amountIn: string }>("/api/intents/quote", { token: asset.token, usdcOut: usdc.toString() });

  step(`Bridge ${asset.symbol} from ${asset.chain} (simulated)`);
  const have = (await intentsBalances(o, d, main.accountId))[asset.token] ?? 0n;
  if (have < BigInt(amountIn)) await post("/api/intents/bridge", { account: main.accountId, token: asset.token, amount: (BigInt(amountIn) - have).toString() });

  step("Register this device with NEAR Intents");
  await ensureKey(o, d, main, key);

  step("Sign one intent: swap and pay the house");
  const msg =
    then.kind === "deposit"
      ? { for: { account_id: main.accountId } }
      : {
          open: {
            market_id: then.market_id,
            side: then.side,
            margin: then.margin.toString(),
            leverage: then.leverage,
            take_profit: then.takeProfit ? then.takeProfit.toString() : null,
            stop_loss: then.stopLoss ? then.stopLoss.toString() : null,
            account_id: main.accountId,
          },
        };
  const signer = createIntentSignerNEP413({
    accountId: main.accountId,
    signMessage: (_p, hash) => ({
      publicKey: key.getPublicKey().toString(),
      signature: btoa(String.fromCharCode(...key.sign(hash).signature)),
    }),
  });
  const salt = await o.view<string>(i.verifier, "current_salt");
  const deadline = new Date(Date.now() + 120_000);
  const saltBytes = new Uint8Array(salt.match(/../g)!.map((h) => parseInt(h, 16)));
  const signed = await signer.signIntent({
    signer_id: main.accountId,
    verifying_contract: i.verifier,
    deadline: deadline.toISOString(),
    nonce: VersionedNonceBuilder.encodeNonce(saltBytes, deadline),
    intents: [
      { intent: "token_diff", diff: { [`nep141:${asset.token}`]: `-${amountIn}`, [`nep141:${d.contracts.usdc}`]: usdc.toString() } },
      {
        intent: "ft_withdraw",
        token: d.contracts.usdc,
        receiver_id: d.contracts.house,
        amount: usdc.toString(),
        msg: JSON.stringify(msg),
        min_gas: teraToGas("120").toString(),
      },
    ],
  } as never);

  step("Solver fills it on the Verifier");
  return post<{ tx: string; logs: string[] }>("/api/intents/fill", { signed, token: asset.token, usdcOut: usdc.toString() });
}
