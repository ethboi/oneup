// The round's lifecycle, named once for the app, the MCP server and the keeper.
//
//   loading ──> open ──(time up)──> ending ──(keeper: close_epoch "begun")──> open (next round)
//
// "ending" is real time on the chain: the round's time is up, but trades still count towards it until the keeper's
// close_epoch starts the next one (contracts/house/src/epochs.rs). The close then settles the finished round in the
// background (get_closing), step by step, while the next round is already open.

import type { Epoch } from "./client.ts";

export type RoundPhase =
  /** The round hasn't been read yet: nothing to count down from. */
  | { phase: "loading" }
  /** Trading counts towards round `id` for `secondsLeft` more seconds. */
  | { phase: "open"; id: number; endsAt: number; secondsLeft: number }
  /** Round `id`'s time is up. Trades still count towards it until the keeper starts the next round, usually within seconds. */
  | { phase: "ending"; id: number; endsAt: number };

type RoundRead = Pick<Epoch, "id" | "started_at">;

/** Where round `epoch` is at `nowS` (seconds). A round that has been read is never "loading". */
export function roundPhase(epoch: RoundRead, epochLengthS: number, nowS: number): Exclude<RoundPhase, { phase: "loading" }>;
export function roundPhase(epoch: RoundRead | null | undefined, epochLengthS: number, nowS: number): RoundPhase;
export function roundPhase(epoch: RoundRead | null | undefined, epochLengthS: number, nowS: number): RoundPhase {
  if (!epoch) return { phase: "loading" };
  const endsAt = epoch.started_at + epochLengthS;
  return nowS < endsAt ? { phase: "open", id: epoch.id, endsAt, secondsLeft: endsAt - nowS } : { phase: "ending", id: epoch.id, endsAt };
}

/** Each step house.close_epoch reports. Closing a round takes several calls; the keeper repeats it until "closed". */
export type CloseStep =
  // before the round's books are swapped: the next round hasn't started yet
  | "waiting for backing"
  | "waiting for pot"
  // the next round has started; the finished one settles from here
  | "begun"
  | "minting"
  | "retrying recovery"
  | "waiting for mints"
  | "expiring"
  | "waiting for expiry"
  | "recalling"
  | "waiting for recall"
  | "drawing jackpot"
  | "closed";
