import { test } from "node:test";
import assert from "node:assert/strict";
import { toItems, trusted, indexBatch, historyFor, boardBetween, standings, netTradePnl, type Out } from "../src/lib/server/activity.ts";

const c = { house: "house.test.near", market: "market.test.near", life: "life.test.near", ve: "ve.test.near", usdc: "usdc.test.near", oneup: "oneup.test.near" };
const opened = { standard: "oneup", event: "position_opened", data: [{ account_id: "bot1.test.near", position_id: 9001, market_id: "NEAR-USD", side: "Long", leverage: 10, margin: "1", entry_price: "1" }] };
const sold = { standard: "oneup_market", event: "sold", data: [{ nft_contract: c.life, token_id: "1", seller: "a.test.near", buyer: "b.test.near", price: "1" }] };

test("indexer takes oneup events only from the house, oneup_market only from the market", () => {
  assert.ok(trusted(opened, c.house, c));
  assert.equal(trusted(opened, "evil.test.near", c), false);
  assert.equal(trusted(opened, c.market, c), false);
  assert.ok(trusted(sold, c.market, c));
  assert.equal(trusted(sold, c.house, c), false);

  const out: Out = { feed: [], history: [] };
  toItems(opened, "evil.test.near", 1, c, out);
  toItems(sold, "evil.test.near", 1, c, out);
  assert.equal(out.feed.length + out.history.length, 0);
  toItems(opened, c.house, 1, c, out);
  toItems(sold, c.market, 1, c, out);
  assert.equal(out.feed.length, 2);
});


test("RPC failures leave a batch uncommitted; retry indexes once and rankings use net profit", async () => {
  const originalFetch = globalThis.fetch;
  let failure = "block";
  const accounts = ["review-alice.test.near", "review-bob.test.near"];
  globalThis.fetch = async (_url, init) => {
    const { method, params } = JSON.parse(String(init?.body));
    if (method === "block") {
      if (params.block_id === 12) return Response.json({ error: { cause: { name: "UNKNOWN_BLOCK" } } });
      if (failure === "block" && params.block_id === 11) throw new Error("timeout");
      return Response.json({ result: { header: { timestamp_nanosec: String(params.block_id * 1e9) }, chunks: [{ chunk_hash: String(params.block_id), tx_root: "has-transactions" }] } });
    }
    if (method === "chunk") return Response.json({ result: { transactions: [{ hash: params.chunk_id, signer_id: "demo", receiver_id: c.house }] } });
    assert.equal(params.wait_until, "FINAL");
    if (failure === "transaction" && params.tx_hash === "11") return Response.json({ error: { cause: { name: "TIMEOUT_ERROR" } } });
    const i = Number(params.tx_hash) - 10;
    const common = { account_id: accounts[i], position_id: 9900 + i };
    const event = (name: string, data: object) => `EVENT_JSON:${JSON.stringify({ standard: "oneup", event: name, data: [data] })}`;
    return Response.json({ result: { receipts_outcome: [{ outcome: { executor_id: c.house, logs: [
      event("position_opened", { ...common, market_id: "NEAR-USD", side: "Long", leverage: 10, margin: "100000000", entry_price: "100000000" }),
      event("position_closed", { ...common, pnl: i === 0 ? "100000000" : "90000000", cut: i === 0 ? "25000000" : "9000000", price: "200000000", reason: "Close" }),
    ] } }] } });
  };
  try {
    const before = historyFor(accounts[0]);
    await assert.rejects(indexBatch("http://test", [10, 11, 12], c), /timeout/);
    assert.deepEqual(historyFor(accounts[0]), before);
    failure = "transaction";
    await assert.rejects(indexBatch("http://test", [10, 11, 12], c), /TIMEOUT_ERROR/);
    assert.deepEqual(historyFor(accounts[0]), before);
    failure = "none";
    await indexBatch("http://test", [10, 11, 12], c);
    assert.equal(historyFor(accounts[0]).items.length, 1);
    assert.equal(historyFor(accounts[1]).items.length, 1);
    const board = boardBetween(10_000, 11_000);
    assert.deepEqual(board.top.map(({ account, pnl }) => ({ account, pnl })), [
      { account: accounts[1], pnl: "81000000" }, { account: accounts[0], pnl: "75000000" },
    ]);
    assert.equal(board.best?.account, accounts[1]);
    assert.deepEqual(board.top.map(x => x.pnl), standings(10_000, 11_000).rows.map(x => x.pnl));
    assert.equal(netTradePnl({ pnl: "-100" }), -100n);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("a failed receipt's logs aren't activity: its state changes rolled back", async () => {
  const { eventLogs } = await import("../src/lib/server/activity.ts");
  const logs = eventLogs(
    [
      { executor_id: "house", logs: ['EVENT_JSON:{"a":1}', "plain text"], status: { SuccessValue: "" } },
      { executor_id: "house", logs: ['EVENT_JSON:{"b":2}'], status: { Failure: { ActionError: {} } } },
      { executor_id: "market", logs: ['EVENT_JSON:{"c":3}'] },
    ],
    "tx1",
  );
  assert.deepEqual(logs, [["house", '{"a":1}', "tx1"], ["market", '{"c":3}', "tx1"]]);
});
