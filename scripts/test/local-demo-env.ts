import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { localDemoEnv } from "../local-demo-env.ts";

test("a local child cannot inherit a public testnet app profile", () => {
  const inherited = { ...process.env, ONEUP_PUBLIC_CONFIG: "/testnet/public.json", ONEUP_CONFIG: "/isolated/localnet.json" };
  const result = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify({remote:process.env.ONEUP_PUBLIC_CONFIG,local:process.env.ONEUP_CONFIG}))"], { env: localDemoEnv(inherited), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { local: "/isolated/localnet.json" });
  assert.equal(inherited.ONEUP_PUBLIC_CONFIG, "/testnet/public.json", "preparing a child must not mutate the caller's configuration");
});
