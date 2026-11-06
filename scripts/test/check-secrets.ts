import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { isPrivatePath, scan } from "../check-secrets.ts";

// Assembled at runtime, so this file doesn't trip the check it tests.
const FAKE_KEY = "ed25519:" + "A1b2C3d4".repeat(11);
const FAKE_RPC = "https://example.near-testnet.quiknode" + ".pro/" + "a1b2c3d4e5f6".repeat(2);

function repo(files: Record<string, string>) {
  const dir = mkdtempSync(resolve(tmpdir(), "oneup-secrets-"));
  const git = (...args: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  const commit = (message: string) => {
    git("add", "-A", "-f");
    git("commit", "-q", "--allow-empty", "-m", message);
  };
  const write = (path: string, text: string) => {
    mkdirSync(dirname(resolve(dir, path)), { recursive: true });
    writeFileSync(resolve(dir, path), text);
  };
  git("init", "-q");
  for (const [path, text] of Object.entries(files)) write(path, text);
  commit("first");
  return { dir, git, commit, write, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a clean repo passes", () => {
  const r = repo({ "README.md": "ed25519:short is a public example\n", "app/.env.example": "ONEUP_RPC=\n" });
  try {
    assert.deepEqual(scan(r.dir), []);
  } finally {
    r.done();
  }
});

test("a key in a current file is found by rule and path", () => {
  const r = repo({ "config.ts": `const key = "${FAKE_KEY}";\n` });
  try {
    assert.ok(scan(r.dir).some((f) => f.rule === "NEAR private key" && f.where === "config.ts"));
  } finally {
    r.done();
  }
});

test("a key removed in a later commit is still found in history", () => {
  const r = repo({ "rpc.txt": `${FAKE_RPC}\n` });
  try {
    r.write("rpc.txt", "gone\n");
    r.commit("remove it");
    const found = scan(r.dir);
    assert.ok(found.some((f) => f.rule === "QuickNode URL with its key" && f.where.startsWith("commit ")));
    assert.ok(!found.some((f) => f.where === "rpc.txt"));
  } finally {
    r.done();
  }
});

test("a key in a commit message is found", () => {
  const r = repo({ "README.md": "hello\n" });
  try {
    r.commit(`debugging with ${FAKE_KEY}`);
    assert.ok(scan(r.dir).some((f) => f.where.startsWith("message of commit ")));
  } finally {
    r.done();
  }
});

test("a private file that was committed and deleted is found", () => {
  const r = repo({ ".testnet/keeper.json": "{}\n" });
  try {
    r.git("rm", "-q", "-r", ".testnet");
    r.commit("remove it");
    assert.ok(scan(r.dir).some((f) => f.rule === "private file committed" && f.where === ".testnet/keeper.json"));
  } finally {
    r.done();
  }
});

test("findings never carry the secret itself", () => {
  const r = repo({ "config.ts": `${FAKE_KEY}\n${FAKE_RPC}\n` });
  try {
    const text = JSON.stringify(scan(r.dir));
    assert.ok(!text.includes(FAKE_KEY));
    assert.ok(!text.includes("a1b2c3d4e5f6"));
  } finally {
    r.done();
  }
});

test("private paths are recognised and templates are allowed", () => {
  for (const path of [".env", "app/.env.local", "operator.json", "a/recovery-keys.json", "wallet.json", "id_ed25519", "x.pem", "a/x.key", "oneup-credential.json", "keeper-main-key", ".testnet/x", "a/.vercel/project.json", ".near-credentials/testnet/a.json"]) {
    assert.equal(isPrivatePath(path), true, path);
  }
  for (const path of [".env.example", "app/.env.local.example", ".env.template", "docs/operator.md", "src/wallet.json.ts", "keys.ts"]) {
    assert.equal(isPrivatePath(path), false, path);
  }
});
