import type { Deployment } from "@oneup/sdk";

/** Browser configuration. Public testnet profiles have no signing keys or privileged identities. */
export type AppDeployment = Pick<Deployment, "network" | "rpcUrl" | "epochLengthS" | "contracts" | "markets"> & {
  demo?: Deployment["demo"];
  bots: Deployment["bots"];
  intents?: Omit<NonNullable<Deployment["intents"]>, "solver"> & { solver: { id: string } };
  testUsdcFaucet?: boolean;
};

const CONTRACTS = ["house", "life", "oneup", "ve", "usdc", "oracle", "swap", "market"] as const;
const OPTIONAL_CONTRACTS = ["vault", "dao"] as const;
/** Public testnet RPCs that answer browsers, in the order the app falls back through them. Our keeper and bots use the last. */
const TESTNET_RPCS = ["https://testnet-rpc.intea.rs/", "https://test.rpc.fastnear.com/", "https://rpc.testnet.near.org/", "https://near-testnet.drpc.org/"];
const TESTNET_RPC_HOSTS = new Set(TESTNET_RPCS.map((url) => new URL(url).hostname));
/** The configured RPC first, then the others. */
export const rpcList = (primary: string) => [primary, ...TESTNET_RPCS.filter((url) => url !== primary)];
const accountPattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*\.testnet$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a configuration object");
  return value as Record<string, unknown>;
}
function testnetContract(value: unknown): string {
  if (typeof value !== "string" || value.length > 64 || !accountPattern.test(value)) throw new Error("Contracts must be named NEAR testnet accounts");
  return value;
}

/** Reconstruct an allowlisted object; never spread a file containing unknown fields into an API response. */
export function parseTestnetConfig(input: unknown): AppDeployment {
  const raw = record(input);
  if (raw.network !== "testnet") throw new Error("The public wallet profile supports testnet only");
  const rpc = new URL(String(raw.rpcUrl));
  if (rpc.protocol !== "https:" || !TESTNET_RPC_HOSTS.has(rpc.hostname) || rpc.username || rpc.password || rpc.port || rpc.search || rpc.hash || rpc.pathname !== "/")
    throw new Error("Use an approved public NEAR testnet RPC URL");
  if (!Number.isSafeInteger(raw.epochLengthS) || Number(raw.epochLengthS) < 1) throw new Error("epochLengthS must be a positive integer");
  const c = record(raw.contracts);
  const contracts = Object.fromEntries(CONTRACTS.map(name => [name, testnetContract(c[name])])) as Deployment["contracts"];
  for (const name of OPTIONAL_CONTRACTS) if (c[name] !== undefined) contracts[name] = testnetContract(c[name]);
  if (!Array.isArray(raw.markets) || raw.markets.length < 1 || raw.markets.length > 20) throw new Error("Configure 1–20 markets");
  const markets = raw.markets.map(value => {
    const m = record(value);
    if (typeof m.id !== "string" || !/^[A-Z0-9-]{1,32}$/.test(m.id) || typeof m.feedId !== "string" || !/^[a-f0-9]{64}$/i.test(m.feedId) || !Number.isFinite(m.simPrice) || Number(m.simPrice) <= 0)
      throw new Error("Invalid market configuration");
    return { id: m.id, feedId: m.feedId, simPrice: Number(m.simPrice) };
  });
  return { network: "testnet", rpcUrl: rpc.href, epochLengthS: Number(raw.epochLengthS), contracts, markets, bots: [], testUsdcFaucet: raw.testUsdcFaucet === true };
}
