import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { checkPorts, judgePorts } from "../preflight.ts";

test("an occupied port fails preflight without closing the unrelated server", async () => {
  const server = createServer((_req, response) => response.end("existing app still alive"));
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  try {
    const result = await checkPorts([{ name: "app", port }]);
    assert.equal(result[0].ok, false);
    assert.match(result[0].detail, /EADDRINUSE/);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "existing app still alive");
  } finally { await new Promise<void>(done => server.close(() => done())); }
  assert.equal((await checkPorts([{ name: "app", port }]))[0].ok, true);
});

test("invalid and duplicate ports are rejected before service startup", async () => {
  const results = await checkPorts([{ name: "app", port: 5000 }, { name: "RPC", port: 5000 }, { name: "network", port: Number.NaN }, { name: "control", port: 80 }]);
  assert.ok(results.every(result => !result.ok));
  assert.match(results[0].detail, /different port/);
  assert.match(results[2].detail, /integer port/);
});

test("all four judge ports can be changed without affecting ordinary demo defaults", () => {
  assert.deepEqual(judgePorts({}).map(p => p.port), [3021, 3130, 25567, 8887]);
  assert.deepEqual(judgePorts({ ONEUP_JUDGE_APP_PORT: "14001", ONEUP_JUDGE_RPC_PORT: "14002", ONEUP_JUDGE_NETWORK_PORT: "14003", ONEUP_JUDGE_CONTROL_PORT: "14004" }).map(p => p.port), [14001, 14002, 14003, 14004]);
});
