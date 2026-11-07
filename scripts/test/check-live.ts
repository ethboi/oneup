import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error A plain .mjs file on purpose, so a reader can run it with no install.
import { ROOT, disclosures, evaluate } from "../check-live.mjs";

const NOW = 1_800_000_000;
const media = { media: "data:image/svg+xml;utf8,<svg/>" };
const healthy = () => ({
  now: NOW,
  accounts: ["house", "life"].map(name => ({ name, codeHash: "Btb5ZcDXED", keys: 0 })),
  params: { max_price_age_s: 60, epoch_length_s: 1800 },
  markets: ["NEAR-USD", "BTC-USD", "ETH-USD"].map(id => ({ id, price: { price: 375500000, expo: -8, publish_time: NOW - 5 } })),
  epoch: { id: 3, started_at: NOW - 600, losses: "5000000", payouts: "0" },
  rounds: [
    { epoch: 1, ended_at: NOW - 2400, house_net: "0", lives_minted: 0, losses: "1", payouts: "2", surplus: "0", lives_pot: "0", buyback_pot: "0" },
    { epoch: 2, ended_at: NOW - 600, house_net: "100000000", lives_minted: 2, losses: "100000000", payouts: "0", surplus: "100000000", lives_pot: "30000000", buyback_pot: "15000000" },
  ],
  positions: [{ owner: `bot1.${ROOT}` }],
  solvency: { pool: "1000000000", markets: [{ liability: "500000000", capacity: "500000000" }] },
  livesState: { lives_paid: "30000000" },
  lifeHeld: "20000000",
  lifeUsdc: "20000000",
  listings: 1,
  owner: ROOT,
  lives: [
    { token_id: `2:bot1.${ROOT}`, owner_id: `bot2.${ROOT}`, epoch: 2, face: "60000000", cap_ppm: "1800000", owed: "108000000", paid: "18000000", claimable: "12000000", backer: false },
    { token_id: `2:bot3.${ROOT}`, owner_id: `bot3.${ROOT}`, epoch: 2, face: "40000000", cap_ppm: "1800000", owed: "72000000", paid: "12000000", claimable: "8000000", backer: false },
  ],
  lifeTokens: [{ metadata: media }, { metadata: media }],
  lockTokens: [{ metadata: media }],
});
type Snapshot = ReturnType<typeof healthy>;
const failures = (snapshot: Snapshot) =>
  evaluate(snapshot).filter((r: { pass: boolean }) => !r.pass).map((r: { name: string }) => r.name);

test("a healthy deployment passes every check", () => {
  assert.deepEqual(failures(healthy()), []);
});

test("pots are rounded the way the contract rounds them", () => {
  const snapshot = healthy();
  // Half of this surplus, then 60% of that, is one unit less than 30% of it in one step.
  Object.assign(snapshot.rounds[1]!, { surplus: "181590697", lives_pot: "54477208", buyback_pot: "27238604" });
  snapshot.livesState.lives_paid = "54477208";
  assert.deepEqual(failures(snapshot), []);
});

test("what fully paid Lives can't take goes to buybacks", () => {
  const snapshot = healthy();
  Object.assign(snapshot.rounds[1]!, { lives_pot: "20000000", buyback_pot: "25000000" });
  snapshot.livesState.lives_paid = "20000000";
  snapshot.lifeHeld = "0"; snapshot.lifeUsdc = "0";
  snapshot.lives.forEach(l => { l.claimable = "0"; l.paid = "10000000"; });
  assert.deepEqual(failures(snapshot), []);
});

const broken: [string, RegExp, (s: Snapshot) => void][] = [
  ["a contract with a key", /nobody holds a key/, s => { s.accounts[0]!.keys = 1; }],
  ["an account with no code", /nobody holds a key/, s => { s.accounts[1]!.codeHash = "11111111111111111111111111111111"; }],
  ["a stale price", /Prices are live/, s => { s.markets[1]!.price.publish_time = NOW - 500; }],
  ["a round that never closes", /Rounds keep closing/, s => { s.epoch.started_at = NOW - 4000; s.rounds[1]!.ended_at = NOW - 4000; }],
  ["a gap between rounds", /Rounds keep closing/, s => { s.rounds[1]!.ended_at = NOW - 900; }],
  ["no trading", /Trades are happening/, s => { s.epoch.losses = "0"; s.rounds[1]!.losses = "0"; s.rounds[1]!.payouts = "0"; }],
  ["liability above capacity", /fits inside the pool/, s => { s.solvency.markets[0]!.liability = "500000001"; }],
  ["Lives from a round with no profit", /house profit/, s => { s.rounds[0]!.lives_minted = 1; }],
  ["Lives bigger than the profit", /house profit/, s => { s.lives[0]!.face = "60000001"; s.lives[0]!.owed = "108000001"; }],
  ["a Life owed more than its cap", /size times/, s => { s.lives[0]!.owed = "108000001"; }],
  ["a Life paid more than it's owed", /size times/, s => { s.lives[1]!.paid = "72000001"; }],
  ["a pot with the wrong share", /exactly what the rounds paid/, s => { s.rounds[1]!.lives_pot = "30000001"; }],
  ["a buyback with the wrong share", /exactly what the rounds paid/, s => { s.rounds[1]!.buyback_pot = "15000001"; }],
  ["a total that doesn't match the rounds", /exactly what the rounds paid/, s => { s.livesState.lives_paid = "29999999"; }],
  ["claims the contract can't cover", /really in the Life NFT/, s => { s.lifeUsdc = "19999999"; }],
  ["no Life ever sold", /change hands/, s => { s.lives[0]!.owner_id = `bot1.${ROOT}`; }],
  ["a sold Life that never collected", /change hands/, s => { s.lives[0]!.paid = "0"; }],
  ["a picture hosted elsewhere", /pictures/, s => { s.lifeTokens[0]!.metadata = { media: "https://example.com/a.svg" }; }],
  ["no Lives at all", /pictures/, s => { s.lifeTokens = []; }],
];
for (const [name, expected, damage] of broken) {
  test(`${name} fails its check`, () => {
    const snapshot = healthy();
    damage(snapshot);
    assert.ok(failures(snapshot).some((f: string) => expected.test(f)), `failed: ${failures(snapshot).join("; ") || "nothing"}`);
  });
}

test("the disclosure names outside traders only when there are any", () => {
  assert.match(disclosures(healthy()).join(" "), /author's bots or operator/);
  const snapshot = healthy();
  snapshot.positions.push({ owner: "alice.testnet" });
  assert.match(disclosures(snapshot).join(" "), /1 outside accounts/);
});
