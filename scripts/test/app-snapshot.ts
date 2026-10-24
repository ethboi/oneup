import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { appInputHash, copyApp } from "../artifacts.ts";

test("app snapshots omit real dotenv files while preserving templates and source identity", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "oneup-snapshot-"));
  const source = resolve(directory, "source");
  const destination = resolve(directory, "snapshot/app");
  mkdirSync(resolve(source, "node_modules"), { recursive: true });
  try {
    writeFileSync(resolve(source, "page.tsx"), "export default function Page() { return 'OneUp'; }");
    for (const name of [".env", ".env.local", ".env.production", ".envrc"]) writeFileSync(resolve(source, name), "PRIVATE_VALUE=do-not-copy");
    for (const name of [".env.example", ".env.testnet.example", ".env.sample", ".env.template"]) writeFileSync(resolve(source, name), "PUBLIC_SETTING=example-only");
    copyApp(destination, source);
    for (const name of [".env", ".env.local", ".env.production", ".envrc"]) assert.equal(existsSync(resolve(destination, name)), false, name);
    for (const name of [".env.example", ".env.testnet.example", ".env.sample", ".env.template"]) assert.match(readFileSync(resolve(destination, name), "utf8"), /example-only/);
    assert.equal(appInputHash(source), appInputHash(destination));
    const before = appInputHash(source);
    writeFileSync(resolve(source, ".env.local"), "PRIVATE_VALUE=changed");
    assert.equal(appInputHash(source), before, "private dotenv files are not published build inputs");
    writeFileSync(resolve(source, "page.tsx"), "export default function Page() { return 'Changed'; }");
    assert.notEqual(appInputHash(source), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
