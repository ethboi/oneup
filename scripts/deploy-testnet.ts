// Default: a pure, offline plan. Only --execute reads credentials, contacts RPC or writes anything.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { MARKETS, ONEUP, USDC, type Deployment } from "@oneup/sdk";
import { CONTRACT_WASMS, ROOT, sha256, sourceIdentity, verifyBuildManifest } from "./artifacts.ts";

const FUNDING = { house: 7, life: 5, oneup: 3, ve: 5, market: 3, usdc: 3, oracle: 2, swap: 2, vault: 2, keeper: 5 } as const;
const CONTRACT_NAMES = Object.keys(CONTRACT_WASMS) as (keyof typeof CONTRACT_WASMS)[];
const ALLOWED_RPC = new Set(["https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"]);
const OPERATOR_RESERVE = 3;
const SEED_USDC = 250_000n * USDC;
const SWAP_USDC = 100_000n * USDC;
const BACKER_ONEUP = 7_500_000n * ONEUP;
const SWAP_ONEUP = 10_000_000n * ONEUP;

type PlanInput = { account?: string; rpcUrl?: string; epochLengthS?: string };
export function testnetPlan(input: PlanInput) {
  const account = input.account ?? "";
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*\.testnet$/.test(account) || account.length > 57) {
    throw Error("ONEUP_TESTNET_ACCOUNT must be a named .testnet account of at most 57 characters; all child account IDs must fit NEAR's 64-character limit.");
  }
  const rpcUrl = input.rpcUrl ?? "https://rpc.testnet.near.org";
  if (!ALLOWED_RPC.has(rpcUrl)) throw Error("RPC must be exactly https://rpc.testnet.near.org or https://test.rpc.fastnear.com.");
  const epochLengthS = Number(input.epochLengthS ?? "600");
  if (!Number.isInteger(epochLengthS) || epochLengthS < 60 || epochLengthS > 604800) throw Error("ONEUP_TESTNET_EPOCH_SECONDS must be an integer from 60 to 604800.");
  const accounts = Object.entries(FUNDING).map(([name, near]) => ({ name, accountId: `${name}.${account}`, allocatedTestNear: near }));
  const contracts = Object.fromEntries(CONTRACT_NAMES.map(name => [name, `${name}.${account}`])) as Record<keyof typeof CONTRACT_WASMS, string>;
  return {
    network: "testnet" as const, operator: account, rpcUrl, epochLengthS, accounts, contracts,
    allocatedTestNear: accounts.reduce((sum, a) => sum + a.allocatedTestNear, 0),
    operatorReserveTestNear: OPERATOR_RESERVE,
    minimumAvailableTestNear: accounts.reduce((sum, a) => sum + a.allocatedTestNear, 0) + OPERATOR_RESERVE,
    outputDirectory: resolve(ROOT, ".testnet", account),
    mocked: ["USDC", "oracle", "swap", "vault"],
    excluded: ["Intents", "bridge", "solver", "DAO", "bots", "mainnet"],
    preparedSeedTestUsdc: "250000", preparedSwapTestUsdc: "100000", mockVaultAprPpm: "0",
    contractKeysDeletedAfterSetup: true,
  };
}
export type TestnetPlan = ReturnType<typeof testnetPlan>;

/** Deliberately construct an allowlisted public object; never serialize the operator deployment. */
export function publicTestnetProfile(plan: TestnetPlan) {
  return { network: "testnet" as const, rpcUrl: plan.rpcUrl, epochLengthS: plan.epochLengthS, contracts: plan.contracts, markets: MARKETS, testUsdcFaucet: true };
}

export function parseTestnetMode(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { plan: { type: "boolean" }, execute: { type: "boolean" } }, allowPositionals: false });
  if (values.plan && values.execute) throw Error("Choose --plan or --execute, not both.");
  return values.execute ? "execute" : "plan";
}

async function rpc(plan: TestnetPlan, method: string, params: unknown) {
  const response = await fetch(plan.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "oneup-testnet-setup", method, params }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw Error(`Testnet RPC returned HTTP ${response.status}; no account absence is assumed.`);
  return response.json() as Promise<{ result?: unknown; error?: { cause?: { name?: string } } }>;
}
export function assertFreshTestnetAccount(accountId: string, result: { result?: unknown; error?: { cause?: { name?: string } } }) {
  if (result.result !== undefined) throw Error(`Account ${accountId} already exists; deployment never updates existing accounts.`);
  if (result.error?.cause?.name === "UNKNOWN_ACCOUNT") return;
  throw Error(`Could not confirm that ${accountId} is absent; check RPC and retry the plan.`);
}
async function assertAccountAbsent(plan: TestnetPlan, accountId: string) {
  assertFreshTestnetAccount(accountId, await rpc(plan, "query", { request_type: "view_account", finality: "final", account_id: accountId }));
}

function readCredential(account: string, credentialPath?: string): KeyPairString {
  if (!credentialPath || !isAbsolute(credentialPath)) throw Error("--execute requires an absolute ONEUP_TESTNET_CREDENTIALS path to a private JSON credential file.");
  const stat = lstatSync(credentialPath);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw Error("Credential file must be a regular, owner-only file (chmod 600) belonging to the current user.");
  let value: Record<string, unknown>;
  try { value = JSON.parse(readFileSync(credentialPath, "utf8")); } catch { throw Error("Credential file is not valid JSON."); }
  if (!value || typeof value !== "object" || value.account_id !== account) throw Error("Credential account_id does not match ONEUP_TESTNET_ACCOUNT.");
  if (value.private_key && value.secret_key && value.private_key !== value.secret_key) throw Error("Credential file contains conflicting keys.");
  const key = value.private_key ?? value.secret_key;
  if (typeof key !== "string" || !key.startsWith("ed25519:")) throw Error("Credential file needs an ed25519 private_key or secret_key.");
  try { KeyPair.fromString(key as KeyPairString); } catch { throw Error("Credential key is invalid."); }
  return key as KeyPairString;
}

export function assertTestnetTransaction(result: unknown) {
  const value = result as { status?: { SuccessValue?: string; Failure?: unknown }; transaction?: { hash?: string }; receipts_outcome?: { outcome: { status: { Failure?: unknown } } }[] };
  if (!value?.status || !("SuccessValue" in value.status) || value.receipts_outcome?.some(r => "Failure" in r.outcome.status)) throw Error("Transaction or one of its receipts did not complete successfully.");
  return value.transaction?.hash ?? null;
}

export async function executeTestnet(plan: TestnetPlan, credentialPath?: string) {
  const canonical = testnetPlan({ account: plan.operator, rpcUrl: plan.rpcUrl, epochLengthS: String(plan.epochLengthS) });
  if (JSON.stringify(plan) !== JSON.stringify(canonical)) throw Error("Deployment plan differs from the fixed reviewed account/budget/output layout.");
  // All checks precede local output creation and chain mutation. Output existence also blocks partial reruns.
  if (existsSync(plan.outputDirectory)) throw Error(`Output directory already exists: ${plan.outputDirectory}. Inspect its progress; automatic resume and redeployment are intentionally unsupported.`);
  const build = verifyBuildManifest();
  const wasm = Object.fromEntries(CONTRACT_NAMES.map(name => [name, readFileSync(resolve(ROOT, `contracts/target/near/${CONTRACT_WASMS[name]}/${CONTRACT_WASMS[name]}.wasm`))])) as Record<keyof typeof CONTRACT_WASMS, Buffer>;
  const operatorKey = readCredential(plan.operator, credentialPath);
  const provider = new JsonRpcProvider({ url: plan.rpcUrl });
  if (await provider.getNetworkId() !== "testnet") throw Error("RPC network is not testnet; deployment aborted.");
  const root = new Account(plan.operator, provider, operatorKey);
  const permission = await provider.viewAccessKey({ accountId: plan.operator, publicKey: KeyPair.fromString(operatorKey).getPublicKey().toString() });
  if (permission.permission !== "FullAccess") throw Error("Operator credential must be a full-access testnet key to create child accounts.");
  const protocol = await rpc(plan, "EXPERIMENTAL_protocol_config", { finality: "final" });
  const storageRate = (protocol.result as { runtime_config?: { storage_amount_per_byte?: string } } | undefined)?.runtime_config?.storage_amount_per_byte;
  if (!storageRate || !/^\d+$/.test(storageRate)) throw Error("Cannot verify testnet storage pricing.");
  const storagePerByte = BigInt(storageRate);
  const state = await provider.viewAccount({ accountId: plan.operator });
  const available = state.amount - BigInt(state.storage_usage) * storagePerByte;
  if (available < nearToYocto(plan.minimumAvailableTestNear)) throw Error(`Operator needs at least ${plan.minimumAvailableTestNear} available test NEAR after existing storage coverage.`);
  for (const name of CONTRACT_NAMES) {
    if (BigInt(wasm[name].byteLength + 100_000) * storagePerByte >= nearToYocto(FUNDING[name])) throw Error(`The ${name} build exceeds its fixed storage budget; revise and review the plan before deployment.`);
  }
  for (const account of plan.accounts) await assertAccountAbsent(plan, account.accountId);

  const parent = resolve(ROOT, ".testnet");
  if (!existsSync(parent)) mkdirSync(parent, { mode: 0o700 });
  if (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) throw Error(".testnet must be a real directory, not a symlink.");
  chmodSync(parent, 0o700);
  mkdirSync(plan.outputDirectory, { mode: 0o700 });
  const keys = Object.fromEntries(plan.accounts.map(a => [a.name, KeyPair.fromRandom("ed25519").toString() as KeyPairString]));
  const save = (name: string, value: unknown) => writeFileSync(resolve(plan.outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  // Persist recovery access before the first transaction. Never log these keys or expose this file to Next.
  save("recovery-keys.json", { network: "testnet", operator: plan.operator, accounts: plan.accounts.map(a => ({ id: a.accountId, key: keys[a.name] })) });
  save("plan.json", plan);
  const progress = { source: sourceIdentity(), build, startedAt: new Date().toISOString(), status: "running", pendingStep: "", completed: [] as { step: string; transactionHash: string | null }[] };
  const checkpoint = () => writeFileSync(resolve(plan.outputDirectory, "progress.json"), `${JSON.stringify(progress, null, 2)}\n`, { mode: 0o600 });
  const run = async (step: string, operation: () => Promise<unknown>) => {
    progress.pendingStep = step; checkpoint();
    const hash = assertTestnetTransaction(await operation());
    progress.completed.push({ step, transactionHash: hash }); progress.pendingStep = ""; checkpoint();
    console.log(`Completed: ${step}`);
  };
  const accounts = Object.fromEntries(plan.accounts.map(a => [a.name, new Account(a.accountId, provider, keys[a.name]!)]));
  const id = (name: keyof typeof CONTRACT_WASMS) => plan.contracts[name];
  const send = (from: Account, receiverId: string, txActions: ReturnType<typeof actions.functionCall>[]) => from.signAndSendTransaction({ receiverId, actions: txActions, waitUntil: "FINAL" });
  const call = (step: string, contractId: string, method: string, args: Record<string, unknown>, deposit = 0n, from = root) => run(step, () => send(from, contractId, [actions.functionCall(method, args, teraToGas("300"), deposit)]));
  const ftCall = (step: string, token: string, receiver: string, amount: bigint, msg: unknown) => call(step, token, "ft_transfer_call", { receiver_id: receiver, amount: amount.toString(), msg: JSON.stringify(msg) }, 1n);
  try {
    for (const a of plan.accounts) await run(`create ${a.name}`, () => send(root, a.accountId, [actions.createAccount(), actions.transfer(nearToYocto(a.allocatedTestNear)), actions.addFullAccessKey(KeyPair.fromString(keys[a.name]!).getPublicKey())]));
    const init: Record<keyof typeof CONTRACT_WASMS, Record<string, unknown>> = {
      usdc: { owner: plan.operator }, oracle: { owner: plan.operator, pusher: accounts.keeper!.accountId },
      house: { owner: plan.operator, usdc: id("usdc"), oracle: id("oracle"), params: { leverage_hard_limit: 1000, min_margin: USDC.toString(), min_hold_s: 60, fill_window_s: 30, max_price_age_s: 60, max_conf_ppm: "10000", solvency_both_sides: true, epoch_length_s: plan.epochLengthS, life_expiry_epochs: 13, market_capacity_ppm: "500000", oneup_per_usdc: 20 } },
      life: { owner: plan.operator, house: id("house"), usdc: id("usdc") },
      oneup: { house: id("house"), rhea_seed: plan.operator, treasury: plan.operator },
      ve: { owner: plan.operator, house: id("house"), oneup: id("oneup") },
      swap: { owner: plan.operator, usdc: id("usdc"), oneup: id("oneup") },
      market: { usdc: id("usdc"), nft_contracts: [id("life"), id("ve")], house: id("house"), fee_ppm: "20000" },
      vault: { usdc: id("usdc"), apr_ppm: "0", year_s: 31_536_000 },
    };
    // Deployment and initialization share one transaction: no public uninitialized-contract window.
    for (const name of CONTRACT_NAMES) await run(`deploy and initialize ${name}`, () => send(accounts[name]!, id(name), [actions.deployContract(wasm[name]), actions.functionCall("new", init[name], teraToGas("300"), 0n)]));
    await call("wire Life", id("house"), "set_life", { life: id("life") });
    await call("wire token and locks", id("house"), "set_token_and_ve", { oneup: id("oneup"), ve: id("ve") });
    await call("wire swap", id("house"), "set_swap", { swap: id("swap") });
    await call("wire vault", id("house"), "set_vault", { vault: id("vault") });
    await call("wire marketplace", id("house"), "set_marketplace", { marketplace: id("market") });
    await call("set keeper", id("house"), "set_keeper", { keeper: accounts.keeper!.accountId });
    await call("set operator", id("house"), "set_operator", { operator: plan.operator });
    for (const market of MARKETS) await call(`add ${market.id}`, id("house"), "add_market", { market_id: market.id, feed_id: market.feedId, max_leverage: 1000 });
    for (const name of ["house", "life", "ve", "swap", "market", "vault"] as const) await call(`register USDC ${name}`, id("usdc"), "mint", { receiver_id: id(name), amount: "0" });
    for (const name of ["ve", "swap", "keeper"] as const) await call(`register token ${name}`, id("oneup"), "storage_deposit", { account_id: accounts[name]!.accountId }, nearToYocto("0.01"));
    await call("mint prepared test USDC", id("usdc"), "mint", { receiver_id: plan.operator, amount: (SEED_USDC + SWAP_USDC).toString() });
    await ftCall("seed house", id("usdc"), id("house"), SEED_USDC, { seed: {} });
    await ftCall("fund backer token allocation", id("oneup"), id("house"), BACKER_ONEUP, { fund_backers: {} });
    await ftCall("seed mock swap USDC", id("usdc"), id("swap"), SWAP_USDC, { add_liquidity: {} });
    await ftCall("seed mock swap tokens", id("oneup"), id("swap"), SWAP_ONEUP, { add_liquidity: {} });
    await call("initial fixed test prices", id("oracle"), "push_prices", { updates: MARKETS.map(m => ({ feed_id: m.feedId, price: Math.round(m.simPrice * 1e8), conf: 0, expo: -8, publish_time: Math.floor(Date.now() / 1000) })) }, 0n, accounts.keeper);
    const solvency = await provider.callFunction({ contractId: id("house"), method: "get_solvency", args: {} }) as { pool?: string };
    if (solvency.pool !== SEED_USDC.toString()) throw Error("Prepared seed verification failed.");
    for (const name of CONTRACT_NAMES) {
      const deployed = await provider.viewContractCode({ contractId: id(name) });
      if (sha256(deployed.code) !== sha256(wasm[name])) throw Error(`Deployed code mismatch: ${name}.`);
    }
    for (const name of CONTRACT_NAMES) await run(`remove deployment key ${name}`, () => send(accounts[name]!, id(name), [actions.deleteKey(KeyPair.fromString(keys[name]!).getPublicKey())]));
    const privateConfig: Deployment = { network: "testnet", rpcUrl: plan.rpcUrl, epochLengthS: plan.epochLengthS, contracts: plan.contracts, owner: { id: plan.operator, key: operatorKey }, keeper: { id: accounts.keeper!.accountId, key: keys.keeper! }, demo: { id: plan.operator, key: operatorKey }, bots: [], markets: MARKETS };
    save("operator.json", privateConfig);
    save("public.json", publicTestnetProfile(plan));
    progress.status = "complete"; progress.pendingStep = ""; checkpoint();
    console.log(`Testnet setup complete. Private keeper config: ${resolve(plan.outputDirectory, "operator.json")}`);
    console.log(`Keyless app profile: ${resolve(plan.outputDirectory, "public.json")}`);
  } catch {
    progress.status = "incomplete"; checkpoint();
    throw Error(`Testnet setup stopped at ${progress.pendingStep || "final verification/output"}. Some transactions may already have completed. Inspect progress.json and on-chain transaction hashes in ${plan.outputDirectory}; recovery-keys.json is private. Do not rerun or delete the folder blindly: automatic resume, account deletion and upgrades are unsupported.`);
  }
}

async function main() {
  const mode = parseTestnetMode(process.argv.slice(2));
  const plan = testnetPlan({ account: process.env.ONEUP_TESTNET_ACCOUNT, rpcUrl: process.env.ONEUP_TESTNET_RPC, epochLengthS: process.env.ONEUP_TESTNET_EPOCH_SECONDS });
  if (mode === "plan") {
    console.log(JSON.stringify({ mode: "plan", effects: "No RPC, credentials, filesystem writes or transactions", ...plan }, null, 2));
    return;
  }
  await executeTestnet(plan, process.env.ONEUP_TESTNET_CREDENTIALS);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Testnet setup failed."); process.exitCode = 1; });
}
