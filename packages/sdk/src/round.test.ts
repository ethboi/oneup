import { describe, expect, it } from "vitest";
import { roundPhase } from "./round.ts";

describe("roundPhase", () => {
  const epoch = { id: 7, started_at: 1_000 };

  it("is loading until the round has been read", () => {
    expect(roundPhase(undefined, 1_800, 1_500)).toEqual({ phase: "loading" });
    expect(roundPhase(null, 1_800, 1_500)).toEqual({ phase: "loading" });
  });

  it("counts down while the round is open", () => {
    expect(roundPhase(epoch, 1_800, 1_000)).toEqual({ phase: "open", id: 7, endsAt: 2_800, secondsLeft: 1_800 });
    expect(roundPhase(epoch, 1_800, 2_799)).toEqual({ phase: "open", id: 7, endsAt: 2_800, secondsLeft: 1 });
  });

  it("is ending from the moment its time is up until the next round starts", () => {
    expect(roundPhase(epoch, 1_800, 2_800)).toEqual({ phase: "ending", id: 7, endsAt: 2_800 });
    expect(roundPhase(epoch, 1_800, 9_999)).toEqual({ phase: "ending", id: 7, endsAt: 2_800 });
  });
});
