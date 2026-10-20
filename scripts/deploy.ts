// Deploys and wires every OneUp contract on the local chain, seeds the pool and the swap, and funds the
// keeper, the bots and a demo trader. Called by `pnpm localnet` on a fresh chain.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPair, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { MARKETS, type Deployment, ONEUP, USDC } from "@oneup/sdk";

const ROOT = resolve(import.meta.dirname, "..");
const WASM = (name: string) => readFileSync(resolve(ROOT, `contracts/target/near/${name}/${name}.wasm`));

const SEED_USDC = 1_000_000n * USDC; // D-1: both-sides solvency needs a deep pool for bot volume
const SWAP_USDC = 100_000n * USDC;
const SWAP_ONEUP = 10_000_000n * ONEUP;
const BOT_USDC = 50_000n * USDC;
const BOTS = 6;

export async function deploy(opts: { home: string; rpcUrl: string; epochLengthS: number }): Promise<Deployment> {
  const provider = new JsonRpcProvider({ url: opts.rpcUrl });
  const validator = JSON.parse(readFileSync(resolve(opts.home, "validator_key.json"), "utf8"));
  const rootId: string = validator.account_id;
  const root = new Account(rootId, provider, validator.secret_key as KeyPairString);

  // One throwaway key for every account this script creates.
  const key = KeyPair.fromRandom("ed25519");
  const keyString = key.toString() as KeyPairString;
  const sub = (name: string) => `${name}.${rootId}`;

  const step = (msg: string) => console.log(`  · ${msg}`);
  const create = async (name: string, near: `${number}`) => {
    await root.createSubAccount({ accountOrPrefix: name, publicKey: key.getPublicKey(), nearToTransfer: nearToYocto(near) });
    return new Account(sub(name), provider, keyString);
  };
  const call = (from: Account, contractId: string, methodName: string, args: Record<string, unknown>, deposit = 0n) =>
    from.callFunction({ contractId, methodName, args, gas: teraToGas("300"), deposit });
  const ftCall = (from: Account, token: string, receiver: string, amount: bigint, msg: string) =>
    call(from, token, "ft_transfer_call", { receiver_id: receiver, amount: amount.toString(), msg }, 1n);

  console.log("Deploying OneUp");
  step("accounts");
  const names = ["usdc", "oracle", "house", "life", "oneup", "ve", "swap"] as const;
  const c = {} as Record<(typeof names)[number], Account>;
  for (const n of names) c[n] = await create(n, "30");
  const keeper = await create("keeper", "100");
  const demo = await create("demo", "50");
  const bots: Account[] = [];
  for (let i = 1; i <= BOTS; i++) bots.push(await create(`bot${i}`, "20"));

  step("code");
  const code: Record<(typeof names)[number], string> = {
    usdc: "mock_usdc",
    oracle: "mock_oracle",
    house: "oneup_house",
    life: "oneup_extra_life",
    oneup: "oneup_token",
    ve: "oneup_ve",
    swap: "mock_swap",
  };
  for (const n of names) await c[n].deployContract(WASM(code[n]));

  step("init");
  const id = (n: (typeof names)[number]) => c[n].accountId;
  await call(root, id("usdc"), "new", { owner: rootId });
  await call(root, id("oracle"), "new", { owner: rootId, pusher: keeper.accountId });
  await call(root, id("house"), "new", {
    owner: rootId,
    usdc: id("usdc"),
    oracle: id("oracle"),
    params: {
      leverage_hard_limit: 250,
      min_margin: USDC.toString(),
      min_hold_s: 60,
      fill_window_s: 30,
      max_price_age_s: 60,
      max_conf_ppm: "10000",
      solvency_both_sides: true,
      epoch_length_s: opts.epochLengthS,
      life_expiry_epochs: 13,
    },
  });
  await call(root, id("life"), "new", { owner: rootId, house: id("house"), usdc: id("usdc") });
  // the root account stands in for the Rhea seed and the treasury
  await call(root, id("oneup"), "new", { house: id("house"), rhea_seed: rootId, treasury: rootId });
  await call(root, id("ve"), "new", { owner: rootId, house: id("house"), oneup: id("oneup"), usdc: id("usdc"), treasury: rootId });
  await call(root, id("swap"), "new", { owner: rootId, usdc: id("usdc"), oneup: id("oneup") });

  step("wiring");
  await call(root, id("house"), "set_life", { life: id("life") });
  await call(root, id("house"), "set_token_and_ve", { oneup: id("oneup"), ve: id("ve") });
  await call(root, id("house"), "set_swap", { swap: id("swap") });
  for (const m of MARKETS) await call(root, id("house"), "add_market", { market_id: m.id, feed_id: m.feedId, max_leverage: 100 });

  step("token registrations");
  for (const a of [id("house"), id("life"), id("ve"), id("swap")]) {
    await call(root, id("usdc"), "mint", { receiver_id: a, amount: "0" });
  }
  for (const a of [id("ve"), id("swap"), keeper.accountId, demo.accountId, ...bots.map((b) => b.accountId)]) {
    await call(root, id("oneup"), "storage_deposit", { account_id: a }, nearToYocto("0.01"));
  }

  step(`seed pool ${SEED_USDC / USDC} USDC`);
  await call(root, id("usdc"), "mint", { receiver_id: rootId, amount: (SEED_USDC + SWAP_USDC).toString() });
  await ftCall(root, id("usdc"), id("house"), SEED_USDC, JSON.stringify({ seed: {} }));

  step("swap liquidity");
  await ftCall(root, id("usdc"), id("swap"), SWAP_USDC, JSON.stringify({ add_liquidity: {} }));
  await ftCall(root, id("oneup"), id("swap"), SWAP_ONEUP, JSON.stringify({ add_liquidity: {} }));

  step("fund bots and demo trader");
  for (const t of [...bots, demo]) {
    await call(root, id("usdc"), "mint", { receiver_id: t.accountId, amount: BOT_USDC.toString() });
    await call(root, id("oneup"), "ft_transfer", { receiver_id: t.accountId, amount: (10_000n * ONEUP).toString() }, 1n);
  }

  return {
    network: "localnet",
    rpcUrl: opts.rpcUrl,
    epochLengthS: opts.epochLengthS,
    contracts: {
      house: id("house"),
      life: id("life"),
      oneup: id("oneup"),
      ve: id("ve"),
      usdc: id("usdc"),
      oracle: id("oracle"),
      swap: id("swap"),
    },
    owner: { id: rootId, key: validator.secret_key },
    keeper: { id: keeper.accountId, key: keyString },
    bots: bots.map((b) => ({ id: b.accountId, key: keyString })),
    demo: { id: demo.accountId, key: keyString },
    markets: MARKETS,
  };
}
