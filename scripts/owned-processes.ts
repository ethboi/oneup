// Only signal process groups created by this instance. Never infer ownership from a port or process name.
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type OwnedChild = { name: string; child: ChildProcess; done: Promise<number | null>; closed: Promise<void>; streamsClosed: boolean; exited: boolean; error?: Error };
export class OwnedProcesses {
  private children: OwnedChild[] = [];
  private logs: WriteStream[] = [];
  private closing: Promise<void> | undefined;
  constructor(private directory: string, private env: NodeJS.ProcessEnv) {}
  start(name: string, command: string, args: string[], cwd: string, onOutput?: (text: string) => void): OwnedChild {
    if (this.closing) throw Error("Cannot start a process after cleanup begins");
    const log = createWriteStream(resolve(this.directory, `${name}.log`), { mode: 0o600 });
    this.logs.push(log);
    const child = spawn(command, args, { cwd, env: this.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const record = { name, child, exited: false, streamsClosed: false } as OwnedChild;
    record.closed = new Promise(resolveClosed => child.once("close", () => { record.streamsClosed = true; resolveClosed(); }));
    record.done = new Promise(resolveDone => {
      child.once("error", error => { record.error = error; record.exited = true; resolveDone(null); });
      child.once("exit", code => { record.exited = true; resolveDone(code); });
    });
    for (const stream of [child.stdout, child.stderr]) stream!.on("data", chunk => { log.write(chunk); onOutput?.(chunk.toString()); });
    this.children.push(record);
    return record;
  }
  async success(record: OwnedChild, timeoutMs: number) {
    let timeout: ReturnType<typeof setTimeout>;
    const expired = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(Error(`${record.name} exceeded ${timeoutMs / 1000}s; see its private log.`)), timeoutMs); });
    try {
      const code = await Promise.race([record.done, expired]);
      if (code !== 0) throw Error(`${record.name} failed (${record.error?.message ?? code}); see its private log.`);
    } finally { clearTimeout(timeout!); }
  }
  assertRunning(records: OwnedChild[]) {
    for (const record of records) if (record.exited) throw Error(`${record.name} exited before the journey completed; see its private log.`);
  }
  close(): Promise<void> {
    return this.closing ??= this.stopAll();
  }
  private async stopAll() {
    const signal = (pid: number, value: NodeJS.Signals) => { try { process.kill(-pid, value); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; } };
    const alive = (pid: number) => { try { process.kill(-pid, 0); return true; } catch { return false; } };
    const pids = this.children.filter(c => !c.streamsClosed).map(c => c.child.pid).filter((pid): pid is number => pid !== undefined);
    for (const pid of pids.reverse()) signal(pid, "SIGTERM");
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline && pids.some(alive)) await delay(50);
    for (const pid of pids) if (alive(pid)) signal(pid, "SIGKILL");
    await Promise.all(this.children.map(c => c.closed));
    await Promise.all(this.logs.map(log => new Promise<void>(resolveClose => log.end(resolveClose))));
  }
}
