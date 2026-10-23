import { test } from "node:test";
import assert from "node:assert/strict";
import { compareAskingPrices, listingPriceInput, listingsPollKey } from "../src/lib/market-pricing.ts";
import { parseTokenAmount } from "@oneup/sdk";

test("listing creation starts blank and repricing preserves the exact current ask", () => {
  assert.equal(listingPriceInput(), "");
  assert.equal(listingPriceInput({ price: "10000000" }), "10");
  assert.equal(listingPriceInput({ price: "1000001" }), "1.000001");
  for (const price of ["1", "999999", "1000001", "1000000000000000000000000000000"]) {
    assert.equal(parseTokenAmount(listingPriceInput({ price }), 6), BigInt(price));
  }
});

test("default market ordering compares actual asks, not conditional caps or claimable balances", () => {
  const listings = [
    { id: "large conditional cap", price: "20000000", additionalCap: "1000000000" },
    { id: "expired with unclaimed funds", price: "10000000", additionalCap: "0" },
    { id: "backer without expiry", price: "15000000", additionalCap: "80000000" },
  ];
  assert.deepEqual(listings.toSorted(compareAskingPrices).map(x => x.id), ["expired with unclaimed funds", "backer without expiry", "large conditional cap"]);
  assert.deepEqual(listings.toSorted((a, b) => compareAskingPrices(a, b, "expensive")).map(x => x.id), ["large conditional cap", "backer without expiry", "expired with unclaimed funds"]);
});

test("asking prices remain ordered above the safe Number precision boundary", () => {
  assert.equal(compareAskingPrices({ price: "9007199254740992" }, { price: "9007199254740993" }), -1);
  assert.equal(compareAskingPrices({ price: "1" }, { price: "1" }), 0);
});

test("same-price sale and relisting refresh the captured seller and approval used by market rows", () => {
  const listing = { nft_contract: "life.test.near", token_id: "1:alice", seller: "alice.test.near", approval_id: 1, price: "10000000", listed_at: 10 };
  const original = listingsPollKey([listing]);
  assert.equal(listingsPollKey([{ ...listing }]), original);
  assert.notEqual(listingsPollKey([{ ...listing, seller: "bob.test.near" }]), original);
  assert.notEqual(listingsPollKey([{ ...listing, approval_id: 2 }]), original);
  assert.notEqual(listingsPollKey([{ ...listing, listed_at: 11 }]), original);
});
