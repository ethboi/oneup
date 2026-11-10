// Whether the app's reads of the chain are getting through. Every poll (usePoll in lib/oneup.tsx) reports here, and
// the notice under the header (components/ReadsNotice.tsx) says so when one has been failing for a while: without
// it a number that can't be read stays "…" or silently out of date.

import { isUnavailable } from "@oneup/sdk";

/** How long a read may fail before the app says so: a few retries on testnet, where one refusal is ordinary. */
export const STALLED_AFTER_MS = 12_000;

/** Reads that are failing because the RPC can't answer: when each started to fail, and how many times in a row. */
const failing = new Map<object, { since: number; error: string; fails: number }>();

/** A read answered. */
export function readOk(poll: object) {
  failing.delete(poll);
}

/**
 * A read failed. Only an RPC that couldn't answer counts: a contract that answers with an error has been reached,
 * and what it said belongs to whoever asked.
 */
export function readFailed(poll: object, e: unknown, now = Date.now()) {
  if (!isUnavailable(e)) {
    failing.delete(poll);
    return;
  }
  const known = failing.get(poll);
  if (known) known.fails++;
  else failing.set(poll, { since: now, error: String(e instanceof Error ? e.message : e).slice(0, 300), fails: 1 });
}

/** The poll has stopped (its component left the page). */
export const readGone = readOk;

/**
 * Reads that have failed more than once in a row, for at least `STALLED_AFTER_MS`, and the error of the one failing
 * longest. One failure isn't enough: a read made once a minute would hold the notice up for a minute over a single
 * refusal.
 */
export function stalledReads(now = Date.now()): { count: number; error: string } {
  const stalled = [...failing.values()].filter((f) => f.fails > 1 && now - f.since >= STALLED_AFTER_MS).sort((a, b) => a.since - b.since);
  return { count: stalled.length, error: stalled[0]?.error ?? "" };
}
