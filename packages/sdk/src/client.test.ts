import { expect, it, vi } from "vitest";
import { OneUp } from "./client.ts";
import type { Deployment } from "./config.ts";

it("lock cursors continue after an entirely filtered page and claim views are batched", async () => {
  const client = new OneUp({ rpcUrl: "http://127.0.0.1:3030", contracts: { ve: "ve" } } as unknown as Deployment);
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  client.view = vi.fn(async (_contract, method, args) => {
    const a = args as Record<string, unknown>; calls.push({ method, args: a });
    if (method === "locks_for_owner_page") return a.from_index === "0" ? { locks: [], next_index: "100" } : { locks: [{ token_id: "101" }], next_index: null };
    return (a.token_ids as string[]).map(id => [id, "5"]);
  }) as typeof client.view;
  expect((await client.locks("alice")).map(x => x.token_id)).toEqual(["101"]);
  expect(calls.map(c => c.args.from_index)).toEqual(["0", "100"]);
  calls.length = 0;
  const claimable = await client.veClaimables(Array.from({ length: 41 }, (_, i) => String(i)), [1]);
  expect(Object.keys(claimable)).toHaveLength(41);
  expect(calls.map(c => (c.args.token_ids as string[]).length)).toEqual([20, 20, 1]);
});
