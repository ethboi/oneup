// `pnpm stop`: stops every OneUp process (chain, keeper, bots, app). It only signals processes whose working
// directory is inside this repo, so other projects' servers are never touched, whatever their command lines.

import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function ancestors(): Set<number> {
  const out = new Set<number>();
  let pid = process.pid;
  while (pid > 1) {
    out.add(pid);
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    pid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
  }
  return out;
}

function ours(): { pid: number; cmd: string }[] {
  const skip = ancestors();
  const found = [];
  for (const d of readdirSync("/proc")) {
    const pid = Number(d);
    if (!pid || skip.has(pid)) continue;
    try {
      const cwd = readlinkSync(`/proc/${pid}/cwd`);
      if (cwd !== ROOT && !cwd.startsWith(ROOT + "/")) continue;
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
      if (cmd) found.push({ pid, cmd });
    } catch {
      // not ours to read, or already gone
    }
  }
  return found;
}

const procs = ours();
if (procs.length === 0) {
  console.log("Nothing running.");
  process.exit(0);
}
for (const p of procs) {
  console.log(`stopping ${p.pid} ${p.cmd.slice(0, 90)}`);
  try {
    process.kill(p.pid, "SIGINT");
  } catch {}
}
await new Promise((r) => setTimeout(r, 3000));
for (const p of ours()) {
  console.log(`killing ${p.pid} ${p.cmd.slice(0, 90)}`);
  try {
    process.kill(p.pid, "SIGKILL");
  } catch {}
}
console.log("Stopped.");
