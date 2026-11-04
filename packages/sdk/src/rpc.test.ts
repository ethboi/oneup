import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonRpcProvider } from "near-api-js";
import { PacedProvider, isRateLimited } from "./rpc.ts";

const limitError = Error('{"jsonrpc": "2.0", "error": {"code": -429, "message": "Rate limits exceeded."}}');
const send = (p: PacedProvider) => p.sendJsonRpc("status" as never, {} as never);
const noWait = async () => {};
afterEach(() => vi.restoreAllMocks());

describe("PacedProvider", () => {
  it("recognises FastNEAR's in-body rate-limit refusal", () => {
    expect(isRateLimited(limitError)).toBe(true);
    expect(isRateLimited(Error("Smart contract panicked"))).toBe(false);
  });

  it("resends a request the RPC refused for its rate limit", async () => {
    vi.spyOn(JsonRpcProvider.prototype, "sendJsonRpc").mockRejectedValueOnce(limitError).mockResolvedValueOnce("ok" as never);
    const p = new PacedProvider("http://rpc.invalid", 0, 5, noWait);
    expect(await send(p)).toBe("ok");
    expect([p.sent, p.limited]).toEqual([2, 1]);
  });

  it("gives up after its retries, and never retries any other error", async () => {
    const parent = vi.spyOn(JsonRpcProvider.prototype, "sendJsonRpc").mockRejectedValue(limitError);
    const p = new PacedProvider("http://rpc.invalid", 0, 2, noWait);
    await expect(send(p)).rejects.toThrow(/-429/);
    expect(p.sent).toBe(3);
    parent.mockRejectedValue(Error("Smart contract panicked"));
    const q = new PacedProvider("http://rpc.invalid", 0, 2, noWait);
    await expect(send(q)).rejects.toThrow(/panicked/);
    expect(q.sent).toBe(1);
  });

  it("spaces concurrent requests by its gap", async () => {
    vi.spyOn(JsonRpcProvider.prototype, "sendJsonRpc").mockResolvedValue("ok" as never);
    const waits: number[] = [];
    const p = new PacedProvider("http://rpc.invalid", 200, 5, async (ms) => void waits.push(ms));
    await Promise.all([send(p), send(p), send(p)]);
    expect(waits.length).toBe(2);
    expect(waits[1]).toBeGreaterThan(waits[0]);
  });

  it("fails a request that never answers, without resending it", async () => {
    const parent = vi.spyOn(JsonRpcProvider.prototype, "sendJsonRpc").mockReturnValue(new Promise(() => {}) as never);
    const p = new PacedProvider("http://rpc.invalid", 0, 5, noWait, 20);
    await expect(send(p)).rejects.toThrow(/no answer/);
    expect(parent).toHaveBeenCalledTimes(1);
  });
});
