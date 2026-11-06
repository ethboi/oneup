import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonRpcProvider } from "near-api-js";
import { FailoverProvider, PacedProvider, TESTNET_RPCS, isRateLimited, rpcList } from "./rpc.ts";

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

describe("PacedProvider's backoff", () => {
  it("holds back a request already waiting for its turn", async () => {
    const sleeps: number[] = [];
    let release = () => {};
    const parked = new Promise<void>((r) => (release = r));
    let parkedOnce = false;
    const p = new PacedProvider("http://rpc.invalid", 100, 5, async (ms) => {
      sleeps.push(ms);
      // the second request waits for its turn while the first is refused
      if (!parkedOnce) {
        parkedOnce = true;
        await parked;
      }
    });
    let calls = 0;
    vi.spyOn(JsonRpcProvider.prototype, "sendJsonRpc").mockImplementation(async () => {
      if (++calls === 1) throw limitError;
      return "ok";
    });
    const first = send(p);
    const second = send(p);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([first, second]);
    // beyond its 100 ms turn, the waiting request also sat out the refusal's cooldown
    expect(sleeps.some((ms) => ms > 500)).toBe(true);
  });
});

describe("FailoverProvider", () => {
  const rpc = (answer: () => unknown) => {
    const p = new JsonRpcProvider({ url: "http://rpc.invalid" });
    const spy = vi.spyOn(p, "sendJsonRpc").mockImplementation(async () => answer());
    return { p, spy };
  };
  const setup = (...rpcs: ReturnType<typeof rpc>[]) => {
    let t = 1000;
    const f = new FailoverProvider(rpcs.map((_, i) => `http://${i}.invalid`), 30_000, () => t, (url) => rpcs[Number(new URL(url).hostname[0])]!.p);
    return { f, advance: (ms: number) => { t += ms; } };
  };
  const call = (f: FailoverProvider) => f.sendJsonRpc("status" as never, {} as never);
  const refuse = () => { throw limitError; };

  it("moves on when an RPC refuses, and rests it", async () => {
    const a = rpc(refuse);
    const b = rpc(() => "b");
    const { f } = setup(a, b);
    expect(await call(f)).toBe("b");
    expect(await call(f)).toBe("b");
    expect(a.spy).toHaveBeenCalledTimes(1);
  });

  it("recognises a refusal however the RPC words it", async () => {
    for (const words of ['{"statusCode": 429, "message": "You have exceeded your limit of 5 requests per minute."}', "Rate limit exceeded, retry after 22 seconds", "HTTP 429"]) {
      const { f } = setup(rpc(() => { throw Error(words); }), rpc(() => "b"));
      expect(await call(f)).toBe("b");
    }
  });

  it("moves on when the browser can't reach an RPC", async () => {
    const { f } = setup(rpc(() => { throw new TypeError("Failed to fetch"); }), rpc(() => "b"));
    expect(await call(f)).toBe("b");
  });

  it("tries a rested RPC again after its rest", async () => {
    let up = false;
    const a = rpc(() => (up ? "a" : refuse()));
    const { f, advance } = setup(a, rpc(() => "b"));
    await call(f);
    up = true;
    advance(30_001);
    expect(await call(f)).toBe("a");
  });

  it("moves on from an RPC that never answers", async () => {
    const a = rpc(() => new Promise(() => {}));
    const f = new FailoverProvider(["http://0.invalid", "http://1.invalid"], 30_000, () => 1000, (url) => (url.includes("0") ? a.p : rpc(() => "b").p), 5);
    expect(await call(f)).toBe("b");
  });

  it("passes on a contract's error without trying another RPC", async () => {
    const b = rpc(() => "b");
    const { f } = setup(rpc(() => { throw Error("Smart contract panicked: Epoch not finished"); }), b);
    await expect(call(f)).rejects.toThrow("panicked");
    expect(b.spy).not.toHaveBeenCalled();
  });

  it("with every RPC resting, asks only the one due back first", async () => {
    const a = rpc(refuse);
    const b = rpc(refuse);
    const { f, advance } = setup(a, b);
    await expect(call(f)).rejects.toThrow();
    advance(1);
    await expect(call(f)).rejects.toThrow();
    expect(a.spy).toHaveBeenCalledTimes(2);
    expect(b.spy).toHaveBeenCalledTimes(1);
  });
});

describe("rpcList", () => {
  it("puts the configured RPC first, once", () => {
    const list = rpcList("https://near-testnet.drpc.org");
    expect(list[0]).toBe("https://near-testnet.drpc.org/");
    expect(list).toHaveLength(TESTNET_RPCS.length);
    expect(new Set(list).size).toBe(list.length);
  });
  it("keeps an RPC that isn't on the list", () => {
    expect(rpcList("https://other.invalid")).toHaveLength(TESTNET_RPCS.length + 1);
  });
});
