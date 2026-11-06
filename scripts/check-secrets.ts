// Looks for credentials in every tracked file and every commit, and for private files that were ever committed.
// Reports the rule and where it matched, never the matched text, so its output is safe to keep in CI logs.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** POSIX extended regexes: git reads them, so they must not use JavaScript-only syntax. */
export const SECRET_RULES = [
  ["NEAR private key", "ed25519:[1-9A-HJ-NP-Za-km-z]{80,}"],
  ["PEM private key", "-----BEGIN [A-Z ]*PRIVATE KEY"],
  ["QuickNode URL with its key", "quiknode\\.pro/[A-Za-z0-9_-]{10,}"],
  ["dRPC URL with its key", "lb\\.drpc\\.[a-z]+/[a-z0-9-]+/[A-Za-z0-9_-]{10,}"],
  ["Upstash address", "[a-z0-9-]+\\.upstash\\.io"],
  ["Upstash token", "KV_REST_API_(READ_ONLY_)?TOKEN *= *[\"']?[A-Za-z0-9_-]{20,}"],
  ["Vercel Blob token", "vercel_blob_rw_[A-Za-z0-9]{10,}"],
  ["GitHub token", "(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})"],
  ["AWS key", "AKIA[0-9A-Z]{16}"],
  ["Google API key", "AIza[0-9A-Za-z_-]{30,}"],
  ["OpenAI or Anthropic key", "sk-[A-Za-z0-9_-]{30,}"],
] as const;

const PRIVATE_PATH = /(^|\/)(\.env(\.[^/]+)?|localnet\.json|operator\.json|recovery-keys\.json|wallet\.json|id_rsa|id_ed25519|[^/]+\.(pem|key|p12|pfx|keystore)|[^/]+-credential\.json|keeper-[^/]+-key)$|(^|\/)(\.testnet|\.localnet|\.judge|\.verification|\.near-credentials|\.vercel)\//;
const TEMPLATE = /(^|\/)\.env\.([^/]+\.)?(example|template)$/;

export const isPrivatePath = (path: string) => PRIVATE_PATH.test(path) && !TEMPLATE.test(path);

export type Finding = { rule: string; where: string };

function git(cwd: string, args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
  // git grep exits 1 for "no matches"; anything else means the check itself didn't run
  if (r.status !== 0 && !(args[0] === "grep" && r.status === 1)) throw new Error(`git ${args[0]} failed with exit ${r.status}`);
  return r.stdout.split("\n").filter(Boolean);
}

export function scan(cwd: string): Finding[] {
  const found: Finding[] = [];
  for (const [rule, regex] of SECRET_RULES) {
    for (const file of git(cwd, ["grep", "-IlE", "-e", regex])) found.push({ rule, where: file });
    for (const commit of git(cwd, ["log", "--all", "--format=%h", `-G${regex}`])) found.push({ rule, where: `commit ${commit}` });
    for (const commit of git(cwd, ["log", "--all", "--format=%h", "-E", `--grep=${regex}`])) found.push({ rule, where: `message of commit ${commit}` });
  }
  const paths = new Set([...git(cwd, ["ls-files"]), ...git(cwd, ["log", "--all", "--diff-filter=A", "--name-only", "--format="])]);
  for (const path of paths) if (isPrivatePath(path)) found.push({ rule: "private file committed", where: path });
  return found;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"])[0]!;
  if (git(root, ["rev-parse", "--is-shallow-repository"])[0] === "true") {
    console.error("This is a shallow clone, so older commits can't be checked. Fetch the full history first.");
    process.exit(1);
  }
  const found = scan(root);
  for (const { rule, where } of found) console.error(`${rule}: ${where}`);
  if (found.length) {
    console.error(`${found.length} possible secrets found. Rotate any real credential: removing it from the repo isn't enough.`);
    process.exit(1);
  }
  console.log(`No secrets found in tracked files or in ${git(root, ["rev-list", "--all", "--count"])[0]} commits.`);
}
