// Checks shared by the API routes. Localnet only: the routes serve dev keys and sign with the root key, so
// they answer only to this machine's own names (a DNS-rebinding guard) and only on a local chain.

import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import type { Deployment } from "@oneup/sdk";

export const configPath = () => resolve(/*turbopackIgnore: true*/ process.env.ONEUP_CONFIG ?? resolve(process.cwd(), "../localnet.json"));
export const stateDir = () => resolve(/*turbopackIgnore: true*/ process.env.ONEUP_STATE_DIR ?? resolve(process.cwd(), "../.localnet"));

export function deployment(): Deployment {
  if (process.env.ONEUP_PUBLIC_CONFIG) throw new Error("Local demo signing is disabled in the public testnet profile");
  const d = JSON.parse(readFileSync(configPath(), "utf8")) as Deployment;
  assertLocalnet(d);
  return d;
}

/** Throws unless `d` is a local chain on this machine: the routes sign with its keys. */
export function assertLocalnet(d: Pick<Deployment, "network" | "rpcUrl">) {
  const host = new URL(d.rpcUrl).hostname;
  if (d.network !== "localnet" || !["127.0.0.1", "localhost"].includes(host)) throw new Error("Localnet only");
}

/** What the browser needs from localnet.json: no root, keeper or solver key. The demo trader's and the
 *  bots' keys stay (the app signs as them: that's the dev wallet). */
export function publicConfig(d: Deployment) {
  assertLocalnet(d);
  return {
    network: d.network,
    rpcUrl: d.rpcUrl,
    epochLengthS: d.epochLengthS,
    contracts: d.contracts,
    intents: d.intents && { verifier: d.intents.verifier, poa: d.intents.poa, assets: d.intents.assets, solver: { id: d.intents.solver.id } },
    demo: { id: d.demo.id, key: d.demo.key },
    bots: d.bots.map((b) => ({ id: b.id, key: b.key })),
    markets: d.markets,
  };
}

const lanIps = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((i) => i?.family === "IPv4")
    .map((i) => i!.address);

/** Loopback, or one of this machine's IPv4s (`pnpm demo --lan`): never a name a stranger's DNS controls. */
export function hostOk(host: string | null, lan: string[] = lanIps()): boolean {
  if (!host) return false;
  const name = host.toLowerCase().replace(/:\d+$/, "");
  return ["127.0.0.1", "localhost", "[::1]"].includes(name) || lan.includes(name);
}

/** null if the request may go on, else the response to send: a foreign Host is refused, and a POST must be
 *  JSON (so a cross-site form or text/plain post, which skips CORS preflight, can't reach a route). */
export function guard(req: Request): Response | null {
  if (process.env.ONEUP_PUBLIC_CONFIG) return Response.json({ error: "This local demo service is disabled on testnet" }, { status: 404 });
  if (!hostOk(req.headers.get("host"))) return Response.json({ error: "Unknown host" }, { status: 403 });
  if (req.method === "POST" && !/^application\/json\b/i.test(req.headers.get("content-type") ?? ""))
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  return null;
}
