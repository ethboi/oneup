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

test("a Life's history: its mint, a gift, a sale (not also counted as a transfer) and only the house's events", async () => {
  const { recordBlock, lifeHistoryFor } = await import("../src/lib/server/activity.ts");
  const id = "7:alice.test.near";
  const ev = (standard: string, event: string, data: unknown) => JSON.stringify({ standard, version: "1.0.0", event, data: [data] });
  recordBlock({ t: 1, logs: [[c.life, ev("nep171", "nft_mint", { owner_id: "alice.test.near", token_ids: [id] }), "tx-mint"]] }, c);
  recordBlock({ t: 2, logs: [[c.life, ev("nep171", "nft_transfer", { old_owner_id: "alice.test.near", new_owner_id: "bob.test.near", token_ids: [id] }), "tx-gift"]] }, c);
  // a forged transfer from another contract is ignored
  recordBlock({ t: 3, logs: [["evil.test.near", ev("nep171", "nft_transfer", { old_owner_id: "bob.test.near", new_owner_id: "evil.test.near", token_ids: [id] }), "tx-evil"]] }, c);
  recordBlock(
    {
      t: 4,
      logs: [
        [c.life, ev("nep171", "nft_transfer", { old_owner_id: "bob.test.near", new_owner_id: "carol.test.near", token_ids: [id] }), "tx-sale"],
        [c.market, ev("oneup_market", "sold", { nft_contract: c.life, token_id: id, seller: "bob.test.near", buyer: "carol.test.near", price: "5000000" }), "tx-sale"],
      ],
    },
    c,
  );
  const kinds = lifeHistoryFor(id).items.map((i) => `${i.kind}@${i.tx}`);
  assert.deepEqual(kinds, ["sold@tx-sale", "transferred@tx-gift", "minted@tx-mint"]);
});

test("a claim's Lives come from its arguments, and only once the Life contract logged the payout", async () => {
  const { lifeClaimLogs, recordBlock, lifeHistoryFor, LIFE_CLAIM } = await import("../src/lib/server/activity.ts");
  const ids = ["8:dave.test.near", "9:dave.test.near"];
  const call = { FunctionCall: { method_name: "claim", args: Buffer.from(JSON.stringify({ token_ids: ids })).toString("base64") } };
  const paid = [{ executor_id: c.life, logs: ["dave.test.near claimed 1500000"], status: { SuccessValue: "dHJ1ZQ==" } }];
  const logs = lifeClaimLogs({ receiver_id: c.life, actions: [call] }, paid, "tx-claim", c);
  assert.equal(logs.length, 1);
  recordBlock({ t: 5, logs }, c);
  for (const id of ids) {
    const [item] = lifeHistoryFor(id).items;
    assert.equal(item.kind, "claimed");
    assert.ok(item.kind === "claimed" && item.amount === "1500000" && item.lives === 2 && item.owner === "dave.test.near" && item.tx === "tx-claim");
  }
  // a failed claim logged no payout; a call to another contract isn't a Life claim
  assert.equal(lifeClaimLogs({ receiver_id: c.life, actions: [call] }, [{ executor_id: c.life, logs: [], status: { Failure: {} } }], "tx-f", c).length, 0);
  assert.equal(lifeClaimLogs({ receiver_id: "evil.test.near", actions: [call] }, paid, "tx-e", c).length, 0);
  // a claim record logged by any other contract is refused
  assert.equal(trusted({ standard: LIFE_CLAIM }, "evil.test.near", c), false);
  assert.ok(trusted({ standard: LIFE_CLAIM }, c.life, c));
});

test("the testnet backfill puts older Life events in front of live ones and marks histories complete", async () => {
  const { recordBlock, lifeHistoryFor, mergeLifeBackfill, livesComplete } = await import("../src/lib/server/activity.ts");
  const id = "10:erin.test.near";
  const ev = (event: string, data: unknown) => JSON.stringify({ standard: "nep171", version: "1.0.0", event, data: [data] });
  recordBlock({ t: 20, logs: [[c.life, ev("nft_transfer", { old_owner_id: "erin.test.near", new_owner_id: "finn.test.near", token_ids: [id] }), "tx-live"]] }, c);
  mergeLifeBackfill([{ t: 10, logs: [[c.life, ev("nft_mint", { owner_id: "erin.test.near", token_ids: [id] }), "tx-old"]] }], c);
  assert.deepEqual(lifeHistoryFor(id).items.map((i) => i.tx), ["tx-live", "tx-old"]);
  assert.ok(livesComplete());
  assert.equal(lifeHistoryFor(id).complete, true);
});
