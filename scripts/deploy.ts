// Deploys and wires every OneUp contract on the local chain, seeds the pool and the swap, and funds the
// keeper, the bots and a demo trader. Called by `pnpm localnet` on a fresh chain.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPair, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { MARKETS, type Deployment, ONEUP, USDC } from "@oneup/sdk";

const ROOT = resolve(import.meta.dirname, "..");
const WASM = (name: string) => readFileSync(resolve(ROOT, `contracts/target/near/${name}/${name}.wasm`));

const SEED_USDC = 250_000n * USDC; // the house's own seed, owed back at 1.0×
/** D-22: bots back the rest of the round at the curve's price, leaving room for the demo trader. D-1's
 *  both-sides solvency needs a deep pool for bot volume. */
const BACKERS: [number, bigint][] = [
  [3, 250_000n * USDC],
  [1, 150_000n * USDC],
  [5, 100_000n * USDC],
  [0, 50_000n * USDC],
];
const SWAP_USDC = 100_000n * USDC;
const SWAP_ONEUP = 10_000_000n * ONEUP;
const BOT_USDC = 50_000n * USDC;
const BOTS = 6;
const SOLVER_USDC = 2_000_000n * USDC;
/** Bridged assets for the simulated bridge: PoA tokens named like the real ones' chains. */
const BRIDGED = [
  { id: "usdc-eth", chain: "Ethereum", symbol: "USDC", decimals: 6, solverInventory: 2_000_000n * 10n ** 6n },
  { id: "usdc-sol", chain: "Solana", symbol: "USDC", decimals: 6, solverInventory: 2_000_000n * 10n ** 6n },
  { id: "eth", chain: "Ethereum", symbol: "ETH", decimals: 18, solverInventory: 1_000n * 10n ** 18n },
];

export async function deploy(opts: { home: string; rpcUrl: string; epochLengthS: number }): Promise<Deployment> {
  const provider = new JsonRpcProvider({ url: opts.rpcUrl });
  const validator = JSON.parse(readFileSync(resolve(opts.home, "validator_key.json"), "utf8"));
  const rootId: string = validator.account_id;
  const root = new Account(rootId, provider, validator.secret_key as KeyPairString);

  // Each account gets its own key: the demo and bot keys go to the browser, so they must not open the
  // keeper, the solver or any contract. Contract accounts' keys are deleted once they're set up.
  const keys = new Map<string, KeyPairString>();
  const sub = (name: string) => `${name}.${rootId}`;

  const step = (msg: string) => console.log(`  · ${msg}`);
  const create = async (name: string, near: `${number}`) => {
    const key = KeyPair.fromRandom("ed25519");
    await root.createSubAccount({ accountOrPrefix: name, publicKey: key.getPublicKey(), nearToTransfer: nearToYocto(near) });
    keys.set(sub(name), key.toString() as KeyPairString);
    return new Account(sub(name), provider, key.toString() as KeyPairString);
  };
  const keyOf = (a: Account) => keys.get(a.accountId)!;
  const publicKeyOf = (a: Account) => KeyPair.fromString(keyOf(a)).getPublicKey();
  const call = (from: Account, contractId: string, methodName: string, args: Record<string, unknown>, deposit = 0n) =>
    from.callFunction({ contractId, methodName, args, gas: teraToGas("300"), deposit });
  const ftCall = (from: Account, token: string, receiver: string, amount: bigint, msg: string) =>
    call(from, token, "ft_transfer_call", { receiver_id: receiver, amount: amount.toString(), msg }, 1n);

  console.log("Deploying OneUp");
  step("accounts");
  const names = ["usdc", "oracle", "house", "life", "oneup", "ve", "swap", "market"] as const;
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
    market: "oneup_market",
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
      market_capacity_ppm: "500000",
      oneup_per_usdc: 20,
    },
  });
  await call(root, id("life"), "new", { owner: rootId, house: id("house"), usdc: id("usdc") });
  // the root account stands in for the Rhea seed and the treasury
  await call(root, id("oneup"), "new", { house: id("house"), rhea_seed: rootId, treasury: rootId });
  await call(root, id("ve"), "new", { owner: rootId, house: id("house"), oneup: id("oneup") });
  await call(root, id("swap"), "new", { owner: rootId, usdc: id("usdc"), oneup: id("oneup") });
  await call(root, id("market"), "new", { usdc: id("usdc"), nft_contracts: [id("life"), id("ve")] });

  step("wiring");
  await call(root, id("house"), "set_life", { life: id("life") });
  await call(root, id("house"), "set_token_and_ve", { oneup: id("oneup"), ve: id("ve") });
  await call(root, id("house"), "set_swap", { swap: id("swap") });
  for (const m of MARKETS) await call(root, id("house"), "add_market", { market_id: m.id, feed_id: m.feedId, max_leverage: 100 });

  step("token registrations");
  for (const a of [id("house"), id("life"), id("ve"), id("swap"), id("market")]) {
    await call(root, id("usdc"), "mint", { receiver_id: a, amount: "0" });
  }
  for (const a of [id("ve"), id("swap"), keeper.accountId, demo.accountId, ...bots.map((b) => b.accountId)]) {
    await call(root, id("oneup"), "storage_deposit", { account_id: a }, nearToYocto("0.01"));
  }

  step(`seed pool ${SEED_USDC / USDC} USDC`);
  await call(root, id("usdc"), "mint", { receiver_id: rootId, amount: (SEED_USDC + SWAP_USDC).toString() });
  await ftCall(root, id("usdc"), id("house"), SEED_USDC, JSON.stringify({ seed: {} }));
  // only the keeper fills orders and fires triggers, so no trader picks their own fill price (D-2, D-19)
  await call(root, id("house"), "set_keeper", { keeper: keeper.accountId });

  step("bootstrap round: bots back the pool (D-22)");
  for (const [i, amount] of BACKERS) {
    await call(root, id("usdc"), "mint", { receiver_id: bots[i].accountId, amount: amount.toString() });
    await ftCall(bots[i], id("usdc"), id("house"), amount, JSON.stringify({ back: {} }));
  }

  step("swap liquidity");
  await ftCall(root, id("usdc"), id("swap"), SWAP_USDC, JSON.stringify({ add_liquidity: {} }));
  await ftCall(root, id("oneup"), id("swap"), SWAP_ONEUP, JSON.stringify({ add_liquidity: {} }));

  // D-21: NEAR Intents. The Verifier and PoA factory are the official near/intents v0.4.2 builds
  // (contracts/vendor). PoA tokens stand in for bridged assets: a simulated bridge (the root account)
  // mints them into the Verifier. A solver keeps USDC and the bridged assets there to fill swaps.
  step("NEAR Intents: Verifier, PoA bridge tokens, solver");
  const vendor = (f: string) => readFileSync(resolve(ROOT, "contracts/vendor", f));
  const wrap = await create("wrap", "10");
  await wrap.deployContract(vendor("wnear.wasm"));
  await call(root, wrap.accountId, "new", {});
  const intents = await create("intents", "100");
  await intents.deployContract(vendor("intents_verifier_v0.4.2.wasm"));
  await call(root, intents.accountId, "new", {
    config: { wnear_id: wrap.accountId, fees: { fee: 0, fee_collector: rootId }, roles: { super_admins: [rootId] } },
  });
  const poa = await create("poa", "100");
  await poa.deployContract(vendor("poa_factory_v0.4.2.wasm"));
  await call(root, poa.accountId, "new", {
    super_admins: [rootId],
    admins: {},
    grantees: { TokenDeployer: [rootId], TokenDepositer: [rootId] },
  });
  for (const a of BRIDGED) {
    await call(root, poa.accountId, "deploy_token", {
      token: a.id,
      metadata: { spec: "ft-1.0.0", name: `${a.symbol} (${a.chain})`, symbol: a.symbol, decimals: a.decimals },
    }, nearToYocto("4"));
    await call(root, `${a.id}.${poa.accountId}`, "storage_deposit", { account_id: intents.accountId }, nearToYocto("0.01"));
  }
  await call(root, id("usdc"), "storage_deposit", { account_id: intents.accountId }, nearToYocto("0.01"));
  const solver = await create("solver", "30");
  await call(solver, intents.accountId, "add_public_key", { public_key: publicKeyOf(solver).toString() }, 1n);
  await call(root, id("usdc"), "mint", { receiver_id: solver.accountId, amount: SOLVER_USDC.toString() });
  await ftCall(solver, id("usdc"), intents.accountId, SOLVER_USDC, "");
  for (const a of BRIDGED) {
    await call(root, poa.accountId, "ft_deposit", {
      token: a.id,
      owner_id: intents.accountId,
      amount: a.solverInventory.toString(),
      msg: solver.accountId,
    }, nearToYocto("0.004"));
  }
  await call(root, id("house"), "set_intents", { intents: intents.accountId });

  // D-20: a Sputnik DAO (the exact code mainnet DAOs run, contracts/vendor) owns the house; the demo
  // trader and two bots are its council. Routine buybacks stay with an operator (the root account the
  // keeper uses), so the DAO only votes on markets and parameters.
  step("Sputnik DAO takes over the house");
  const dao = await create("dao", "30");
  await dao.deployContract(readFileSync(resolve(ROOT, "contracts/vendor/sputnikdao2.wasm")));
  const council = [demo.accountId, bots[3].accountId, bots[5].accountId];
  await call(root, dao.accountId, "new", {
    config: { name: "oneup-dao", purpose: "Governs the OneUp house: markets and their share of the pool", metadata: "" },
    policy: {
      roles: [
        { name: "all", kind: "Everyone", permissions: ["*:AddProposal"], vote_policy: {} },
        {
          name: "council",
          kind: { Group: council },
          permissions: ["*:AddProposal", "*:VoteApprove", "*:VoteReject", "*:VoteRemove", "*:Finalize"],
          vote_policy: {},
        },
      ],
      default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] },
      proposal_bond: nearToYocto("0.1").toString(),
      proposal_period: (3_600n * 1_000_000_000n).toString(), // an hour, for the demo
      bounty_bond: nearToYocto("1").toString(),
      bounty_forgiveness_period: (86_400n * 1_000_000_000n).toString(),
    },
  });
  await call(root, id("house"), "set_operator", { operator: rootId });
  await call(root, id("house"), "set_owner", { owner: dao.accountId });

  step("fund bots and demo trader");
  for (const t of [...bots, demo]) {
    await call(root, id("usdc"), "mint", { receiver_id: t.accountId, amount: BOT_USDC.toString() });
    await call(root, id("oneup"), "ft_transfer", { receiver_id: t.accountId, amount: (10_000n * ONEUP).toString() }, 1n);
  }

  step("lock the contract accounts (delete their keys)");
  for (const a of [...names.map((n) => c[n]), wrap, intents, poa, dao]) {
    await a.deleteKey(publicKeyOf(a));
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
      market: id("market"),
      dao: dao.accountId,
    },
    intents: {
      verifier: intents.accountId,
      poa: poa.accountId,
      solver: { id: solver.accountId, key: keyOf(solver) },
      assets: BRIDGED.map((a) => ({ token: `${a.id}.${poa.accountId}`, chain: a.chain, symbol: a.symbol, decimals: a.decimals })),
    },
    owner: { id: rootId, key: validator.secret_key },
    keeper: { id: keeper.accountId, key: keyOf(keeper) },
    bots: bots.map((b) => ({ id: b.accountId, key: keyOf(b) })),
    demo: { id: demo.accountId, key: keyOf(demo) },
    markets: MARKETS,
  };
}
