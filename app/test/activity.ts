import { test } from "node:test";
import assert from "node:assert/strict";
import { toItems, trusted, type Out } from "../src/lib/server/activity.ts";

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
