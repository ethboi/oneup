import { test } from "node:test";
import assert from "node:assert/strict";
import { lockImage, partsLeft } from "../src/lib/lockArt.ts";

test("a lock with any time left never reads empty, and a full one reads full", () => {
  assert.equal(partsLeft(104, 104, 5), 5);
  assert.equal(partsLeft(1, 104, 5), 1);
  assert.equal(partsLeft(0, 104, 5), 0);
  assert.equal(partsLeft(200, 104, 8), 8);
});

test("each state draws its own picture", () => {
  const pictures = new Set([lockImage(50, 104, "locked"), lockImage(0, 104, "ready"), lockImage(0, 104, "closed")]);
  assert.equal(pictures.size, 3);
  assert.ok(lockImage(104, 104, "locked") !== lockImage(1, 104, "locked"), "the body drains as the unlock nears");
  assert.ok(lockImage(0, 104, "ready").startsWith("data:image/svg+xml"));
});
