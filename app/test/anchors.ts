import { test } from "node:test";
import assert from "node:assert/strict";
import { scrollToAnchorWhenReady } from "../src/lib/anchors.ts";

function page() {
  const present = new Set<string>(), scrolls: string[] = [];
  const listeners = new Set<() => void>();
  return { present, scrolls, listeners,
    find: (id: string) => present.has(id) ? { scrollIntoView: () => { scrolls.push(id); } } : null,
    observe: (check: () => void) => { listeners.add(check); return () => { listeners.delete(check); }; },
    render: (id: string) => { present.add(id); for (const f of listeners) f(); },
  };
}

test("direct hash waits through multiple asynchronous loading stages and scrolls once", () => {
  const dom = page();
  scrollToAnchorWhenReady("fairness", dom);
  dom.render("loading-house"); dom.render("pool-at-work"); dom.render("loading-simulation");
  assert.deepEqual(dom.scrolls, []);
  dom.render("fairness"); dom.render("unrelated-poll");
  assert.deepEqual(dom.scrolls, ["fairness"]);
  assert.equal(dom.listeners.size, 0);
});

test("navigation cancels pending scroll; Back starts a fresh observer", () => {
  const dom = page();
  const cancel = scrollToAnchorWhenReady("fairness", dom);
  cancel();
  dom.render("fairness");
  assert.deepEqual(dom.scrolls, []);
  scrollToAnchorWhenReady("fairness", dom);
  assert.deepEqual(dom.scrolls, ["fairness"]);
  assert.equal(dom.listeners.size, 0);
});
