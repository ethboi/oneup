// Finishes a testnet deployment that `pnpm deploy:testnet --execute` left incomplete after its contracts were
// deployed, wired and their markets added (for example, when the RPC started refusing requests). It runs the
// remaining setup steps in the deploy's order, skipping any whose effect is already on chain, then verifies,
// removes the contract deployment keys and writes operator.json and public.json, like a complete deploy.
//
//   ONEUP_TESTNET_ACCOUNT=<operator>.testnet ONEUP_TESTNET_CREDENTIALS=/abs/operator-key.json \
//     ONEUP_TESTNET_RPC=https://test.rpc.fastnear.com pnpm testnet:finish

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { MARKETS, ONEUP, USDC, type Deployment } from "@oneup/sdk";
import { CONTRACT_WASMS, ROOT, sha256 } from "./artifacts.ts";
import { assertTestnetTransaction, publicTestnetProfile, testnetPlan, type TestnetPlan } from "./deploy-testnet.ts";

const SEED_USDC = 250_000n * USDC;
const SWAP_USDC = 100_000n * USDC;
const BACKER_ONEUP = 7_500_000n * ONEUP;
const SWAP_ONEUP = 10_000_000n * ONEUP;
const CONTRACT_NAMES = Object.keys(CONTRACT_WASMS) as (keyof typeof CONTRACT_WASMS)[];

const operator = process.env.ONEUP_TESTNET_ACCOUNT ?? "";
const rpcUrl = process.env.ONEUP_TESTNET_RPC ?? "https://test.rpc.fastnear.com";
const dir = resolve(ROOT, ".testnet", operator);
const saved: TestnetPlan = JSON.parse(readFileSync(resolve(dir, "plan.json"), "utf8"));
// the same accounts and budget as the deploy that started, only the RPC may change
const plan = testnetPlan({ account: operator, rpcUrl, epochLengthS: String(saved.epochLengthS) });
if (JSON.stringify({ ...saved, rpcUrl }) !== JSON.stringify(plan)) throw Error("plan.json does not match this operator's deployment plan.");
const progress = JSON.parse(readFileSync(resolve(dir, "progress.json"), "utf8")) as { status: string; pendingStep: string; completed: { step: string; transactionHash: string | null }[]; finishedBy?: string };
if (progress.status === "complete") throw Error("This deployment is already complete.");
if (!progress.completed.some((s) => s.step === "add ETH-USD")) throw Error("The deploy stopped before its markets were added; this script only finishes the later steps.");
const recovery = JSON.parse(readFileSync(resolve(dir, "recovery-keys.json"), "utf8")) as { accounts: { id: string; key: KeyPairString }[] };
const keyOf = (name: string) => recovery.accounts.find((a) => a.id === `${name}.${operator}`)!.key;

const credential = JSON.parse(readFileSync(process.env.ONEUP_TESTNET_CREDENTIALS ?? "", "utf8")) as { account_id: string; private_key?: string; secret_key?: string };
if (credential.account_id !== operator) throw Error("Credential account_id does not match ONEUP_TESTNET_ACCOUNT.");
const operatorKey = (credential.private_key ?? credential.secret_key) as KeyPairString;

const provider = new JsonRpcProvider({ url: rpcUrl });
if ((await provider.getNetworkId()) !== "testnet") throw Error("RPC network is not testnet.");
const root = new Account(operator, provider, operatorKey);
const keeper = new Account(`keeper.${operator}`, provider, keyOf("keeper"));
const id = (name: keyof typeof CONTRACT_WASMS) => plan.contracts[name];
const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) => provider.callFunction({ contractId, method, args }) as Promise<T>;
const save = () => writeFileSync(resolve(dir, "progress.json"), `${JSON.stringify(progress, null, 2)}\n`, { mode: 0o600 });

async function step(name: string, done: () => Promise<boolean>, send: () => Promise<unknown>) {
  if (progress.completed.some((s) => s.step === name)) return;
  if (await done()) {
    progress.completed.push({ step: name, transactionHash: null });
    console.log(`Already on chain: ${name}`);
  } else {
    progress.pendingStep = name;
    save();
    progress.completed.push({ step: name, transactionHash: assertTestnetTransaction(await send()) });
    console.log(`Completed: ${name}`);
  }
  progress.pendingStep = "";
  save();
}
const fn = (from: Account, contractId: string, method: string, args: Record<string, unknown>, deposit = 0n) =>
  from.signAndSendTransaction({ receiverId: contractId, actions: [actions.functionCall(method, args, teraToGas("300"), deposit)], waitUntil: "FINAL" });
const ft = (token: string, receiver: string, amount: bigint, msg: unknown) =>
  fn(root, token, "ft_transfer_call", { receiver_id: receiver, amount: amount.toString(), msg: JSON.stringify(msg) }, 1n);
const registered = (token: string, account: string) => view<unknown>(token, "storage_balance_of", { account_id: account }).then((x) => x !== null);
const balance = (token: string, account: string) => view<string>(token, "ft_balance_of", { account_id: account }).then(BigInt);

progress.finishedBy = "scripts/testnet-finish.ts";
for (const name of ["house", "life", "ve", "swap", "market", "vault"] as const)
  await step(`register USDC ${name}`, () => registered(id("usdc"), id(name)), () => fn(root, id("usdc"), "mint", { receiver_id: id(name), amount: "0" }));
for (const name of ["ve", "swap", "keeper"] as const)
  await step(`register token ${name}`, () => registered(id("oneup"), `${name}.${operator}`), () => fn(root, id("oneup"), "storage_deposit", { account_id: `${name}.${operator}` }, nearToYocto("0.01")));
const solvency = () => view<{ pool?: string }>(id("house"), "get_solvency");
await step("mint prepared test USDC", async () => (await balance(id("usdc"), operator)) >= SEED_USDC + SWAP_USDC || (await solvency()).pool === SEED_USDC.toString(), () => fn(root, id("usdc"), "mint", { receiver_id: operator, amount: (SEED_USDC + SWAP_USDC).toString() }));
await step("seed house", async () => (await solvency()).pool === SEED_USDC.toString(), () => ft(id("usdc"), id("house"), SEED_USDC, { seed: {} }));
// no cheap view tells these apart from a later state, so they rely on the progress log: none had run when it stopped
await step("fund backer token allocation", async () => false, () => ft(id("oneup"), id("house"), BACKER_ONEUP, { fund_backers: {} }));
await step("seed mock swap USDC", async () => (await balance(id("usdc"), id("swap"))) >= SWAP_USDC, () => ft(id("usdc"), id("swap"), SWAP_USDC, { add_liquidity: {} }));
await step("seed mock swap tokens", async () => (await balance(id("oneup"), id("swap"))) >= SWAP_ONEUP, () => ft(id("oneup"), id("swap"), SWAP_ONEUP, { add_liquidity: {} }));
await step("initial fixed test prices", async () => false, () => fn(keeper, id("oracle"), "push_prices", { updates: MARKETS.map((m) => ({ feed_id: m.feedId, price: Math.round(m.simPrice * 1e8), conf: 0, expo: -8, publish_time: Math.floor(Date.now() / 1000) })) }));

if ((await solvency()).pool !== SEED_USDC.toString()) throw Error("Prepared seed verification failed.");
for (const name of CONTRACT_NAMES) {
  const wasm = readFileSync(resolve(ROOT, `contracts/target/near/${CONTRACT_WASMS[name]}/${CONTRACT_WASMS[name]}.wasm`));
  const deployed = await provider.viewContractCode({ contractId: id(name) });
  if (sha256(deployed.code) !== sha256(wasm)) throw Error(`Deployed code mismatch: ${name}.`);
}
console.log("Verified: pool seed and all nine contracts' code.");
for (const name of CONTRACT_NAMES) {
  const pub = KeyPair.fromString(keyOf(name)).getPublicKey();
  await step(`remove deployment key ${name}`, () => provider.viewAccessKeyList({ accountId: id(name) }).then((l) => !l.keys.some((k) => k.public_key === pub.toString())), () => new Account(id(name), provider, keyOf(name)).signAndSendTransaction({ receiverId: id(name), actions: [actions.deleteKey(pub)], waitUntil: "FINAL" }));
}
const privateConfig: Deployment = { network: "testnet", rpcUrl, epochLengthS: plan.epochLengthS, contracts: plan.contracts, owner: { id: operator, key: operatorKey }, keeper: { id: `keeper.${operator}`, key: keyOf("keeper") }, demo: { id: operator, key: operatorKey }, bots: [], markets: MARKETS };
writeFileSync(resolve(dir, "operator.json"), `${JSON.stringify(privateConfig, null, 2)}\n`, { mode: 0o600, flag: "wx" });
writeFileSync(resolve(dir, "public.json"), `${JSON.stringify(publicTestnetProfile(plan), null, 2)}\n`, { mode: 0o600, flag: "wx" });
progress.status = "complete";
save();
console.log(`Testnet setup complete. Private keeper config: ${resolve(dir, "operator.json")}\nKeyless app profile: ${resolve(dir, "public.json")}`);
