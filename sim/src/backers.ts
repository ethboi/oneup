// How long until the bootstrap round's Backer Lives (D-22) are paid in full, at different trading levels.
//
// Same rules as model.ts and the contracts: each epoch the house keeps traders' net losses; the payout is half
// the pool above its reserve (max of 1.2 × open max wins and the total seeded, so never below what backers put
// in); 60% of it goes to Life NFTs. Backer Lives share that pot with losers' lives, which are owed their
// loss × the cap curve and stop earning after 14 epochs; Backer Lives never expire. Plain floats, weekly
// epochs, 200 seeds per level. Runs both ways of sharing the pot: by what each life was originally owed (D-25,
// the contracts) and by what each is still owed (before D-25), whose last few percent take years.
//
//   pnpm --filter @oneup/sim backers

import { flows } from "./model.ts";

const ROUND = 1_000_000;
const OWNER_SEED = 250_000; // seeded through back() at 1.0× (scripts/deploy.ts)
const cap = (pool: number) => 2.0 - (0.8 * Math.min(pool, 1_000_000)) / 1_000_000;
/** The round's Backer Lives: the owner's seed at 1.0×, then the curve's average over the rest. */
const BACKERS_OWED = OWNER_SEED + (ROUND - OWNER_SEED) * ((cap(OWNER_SEED) + cap(ROUND)) / 2);
const POTS = 14; // the epoch a life is minted in and the 13 after
const UTILISATION = 0.5; // open max wins as a share of the pool
const EPOCHS = 520; // ten years of weekly epochs
const SEEDS = 200;

/** Epochs until the backers have been paid `share` of what they're owed (Infinity if never in the run). */
type Rule = "split" | "owed" | "remaining";
type Life = { face: number; owed: number };

/** Water-filling: the same fraction of each life's original owed, capped at what's left; any excess goes round
 *  again. Returns what the lives couldn't take. */
function fill(lives: Life[], amount: number): number {
  let left = amount;
  let open = lives.filter((x) => x.owed > 1e-6);
  while (left > 1e-6 && open.length) {
    const rate = left / open.reduce((s, x) => s + x.face, 0);
    const full = open.filter((x) => x.owed <= rate * x.face);
    if (full.length === 0) {
      for (const x of open) x.owed -= rate * x.face;
      return 0;
    }
    for (const x of full) {
      left -= x.owed;
      x.owed = 0;
    }
    open = open.filter((x) => x.owed > 1e-6);
  }
  return left;
}

/** Epochs until backers have been paid each of `shares` (Infinity if not within the run), and the share of what
 *  losers' lives were owed that they were paid before expiring. */
function run(weeklyLosses: number, edge: number, seed: number, shares: number[], rule: Rule) {
  const fs = flows({ epochs: EPOCHS, start: weeklyLosses, peak: weeklyLosses, mid: 0, edge, seed });
  let pool = ROUND;
  const backer: Life = { face: BACKERS_OWED, owed: BACKERS_OWED };
  const losers: (Life & { epoch: number })[] = [];
  let loserFace = 0;
  let loserPaid = 0;
  const reached = shares.map(() => Infinity);
  fs.forEach((f, e) => {
    const net = f.losses - f.payouts;
    pool += net;
    if (net > 0) {
      losers.push({ epoch: e, face: net * cap(pool), owed: net * cap(pool) });
      loserFace += net * cap(pool);
    }
    for (const l of losers) if (e - l.epoch >= POTS) l.owed = 0;
    const reserve = Math.max(1.2 * UTILISATION * pool, ROUND);
    const payout = 0.5 * Math.max(0, pool - reserve);
    const owedNow = backer.owed + losers.reduce((s, l) => s + l.owed, 0);
    const pot = Math.min(0.6 * payout, owedNow);
    const losersBefore = losers.reduce((s, l) => s + l.owed, 0);
    if (pot > 0 && rule === "remaining") {
      backer.owed -= (pot * backer.owed) / owedNow;
      for (const l of losers) l.owed -= (pot * l.owed) / owedNow;
    } else if (pot > 0 && rule === "owed") {
      fill([backer, ...losers], pot);
    } else if (pot > 0) {
      // D-26: two thirds to losers' lives, one third to Backer Lives; each passes on what it can't use
      const slice = (pot * 2) / 3;
      const lLeft = fill(losers, slice);
      const bLeft = fill([backer], pot - slice);
      fill([backer], lLeft);
      fill(losers, bLeft);
    }
    loserPaid += losersBefore - losers.reduce((s, l) => s + l.owed, 0);
    // the rest of the 60% (if lives are paid up) joins the 30% buyback; 10% stays in the pool
    pool -= pot + (0.9 * payout - pot);
    shares.forEach((s, i) => {
      if (reached[i] === Infinity && backer.owed <= BACKERS_OWED * (1 - s) + 1) reached[i] = e + 1;
    });
  });
  return { reached, loserShare: loserFace > 0 ? loserPaid / loserFace : 0 };
}

const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const years = (w: number) => (w === Infinity ? "never (10 yrs+)" : w >= 104 ? `${(w / 52).toFixed(1)} years` : `${w} weeks`);

console.log(`Bootstrap round: $${ROUND.toLocaleString()} backed, Backer Lives owed $${Math.round(BACKERS_OWED).toLocaleString()}`);
console.log(`House keeps 15% of traders' losses on average (as in the fairness simulation), weekly epochs, ${SEEDS} runs each\n`);
const SHARES = [0.25, 0.5, 0.9, 0.99, 1];
const TITLE: Record<Rule, string> = {
  split: "Two thirds to losers' lives, one third to Backer Lives, each by original owed (D-26, the contracts):",
  owed: "\nAll lives together, by original owed (D-25 alone):",
  remaining: "\nAll lives together, by what's still owed (before D-25):",
};
for (const rule of ["split", "owed", "remaining"] as const) {
  console.log(TITLE[rule]);
  for (const weekly of [25_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000]) {
    const runs = Array.from({ length: SEEDS }, (_, i) => run(weekly, 0.15, i + 1, SHARES, rule));
    const cols = SHARES.map((_, k) => runs.map((r) => r.reached[k]));
    const median = cols.map((c) => years(pct(c, 0.5)));
    const losersGot = pct(runs.map((r) => r.loserShare), 0.5);
    console.log(
      `  traders lose $${(weekly / 1000).toLocaleString()}K/week:`.padEnd(30) +
        `backers 50% paid ${median[1]}, 90% ${median[2]}, in full ${median[4]}; losers' lives paid ${(losersGot * 100).toFixed(0)}% of their cap`,
    );
  }
}
