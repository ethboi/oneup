import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { OwnedProcesses } from "../owned-processes.ts";

async function portAvailable(port: number) {
  const server = createServer();
  return new Promise<boolean>(done => { server.once("error", () => done(false)); server.listen(port, "127.0.0.1", () => server.close(() => done(true))); });
}
test("cleanup kills only owned process groups, including a stubborn child, and can run twice", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "oneup-owned-"));
  const processes = new OwnedProcesses(directory, process.env);
  const independent = createServer();
  await new Promise<void>(done => independent.listen(0, "127.0.0.1", done));
  const independentPort = (independent.address() as { port: number }).port;
  let ownPort = 0;
  try {
    // A grandchild inherits the owned group and ignores TERM. Its listening port proves KILL reached it.
    const grandchild = `const net=require("node:net");process.on("SIGTERM",()=>{});const s=net.createServer();s.listen(0,"127.0.0.1",()=>console.log(s.address().port));`;
    const parent = `const cp=require("node:child_process");cp.spawn(process.execPath,["-e",${JSON.stringify(grandchild)}],{stdio:["ignore","inherit","inherit"]});`;
    const child = processes.start("tree", process.execPath, ["-e", parent], directory, text => { ownPort = Number(text.trim()); });
    const deadline = Date.now() + 5000;
    while (!ownPort && Date.now() < deadline) { processes.assertRunning([child]); await delay(25); }
    assert.ok(ownPort > 0, "grandchild bound a port");
    assert.equal(await portAvailable(ownPort), false);
    await processes.close();
    await processes.close();
    assert.equal(await portAvailable(ownPort), true, "owned grandchild was terminated");
    assert.equal(await portAvailable(independentPort), false, "unrelated server is still running");
    assert.throws(() => processes.start("late", process.execPath, ["-e", ""], directory), /cleanup/);
  } finally { await processes.close(); await new Promise<void>(done => independent.close(() => done())); rmSync(directory, { recursive: true, force: true }); }
});

test("a phase timeout reports failure and cleanup releases its child", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "oneup-timeout-"));
  const processes = new OwnedProcesses(directory, process.env);
  try {
    const child = processes.start("slow", process.execPath, ["-e", "setInterval(()=>{},1000)"], directory);
    await assert.rejects(processes.success(child, 50), /slow exceeded/);
    await processes.close();
    assert.equal(child.exited, true);
  } finally { await processes.close(); rmSync(directory, { recursive: true, force: true }); }
});
