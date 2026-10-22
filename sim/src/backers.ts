// How long until the bootstrap round's Backer Lives (D-22) are paid in full, at different trading levels.
//
// Same rules as model.ts and the contracts: each epoch the house keeps traders' net losses; the payout is half
// the pool above its reserve (max of 1.2 × open max wins and the total seeded, so never below what backers put
// in); 60% of it goes to Extra Lives. Backer Lives share that pot with losers' lives, which are owed their
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
function run(weeklyLosses: number, edge: number, seed: number, shares: number[], rule: "owed" | "remaining") {
  const fs = flows({ epochs: EPOCHS, start: weeklyLosses, peak: weeklyLosses, mid: 0, edge, seed });
  let pool = ROUND;
  let backers = BACKERS_OWED;
  const losers: { epoch: number; face: number; owed: number }[] = [];
  const reached = shares.map(() => Infinity);
  fs.forEach((f, e) => {
    const net = f.losses - f.payouts;
    pool += net;
    if (net > 0) losers.push({ epoch: e, face: net * cap(pool), owed: net * cap(pool) });
    for (const l of losers) if (e - l.epoch >= POTS) l.owed = 0;
    const reserve = Math.max(1.2 * UTILISATION * pool, ROUND);
    const payout = 0.5 * Math.max(0, pool - reserve);
    const owed = backers + losers.reduce((s, l) => s + l.owed, 0);
    const pot = Math.min(0.6 * payout, owed);
    if (pot > 0 && rule === "remaining") {
      backers -= (pot * backers) / owed;
      for (const l of losers) l.owed -= (pot * l.owed) / owed;
    } else if (pot > 0) {
      // the same fraction of each life's original owed, capped at what's left; any excess goes round again
      let left = pot;
      const lives = [{ face: BACKERS_OWED, get: () => backers, set: (v: number) => (backers = v) }, ...losers.map((l) => ({ face: l.face, get: () => l.owed, set: (v: number) => (l.owed = v) }))];
      let open = lives.filter((x) => x.get() > 1e-6);
      while (left > 1e-6 && open.length) {
        const rate = left / open.reduce((s, x) => s + x.face, 0);
        const full = open.filter((x) => x.get() <= rate * x.face);
        if (full.length === 0) {
          for (const x of open) x.set(x.get() - rate * x.face);
          left = 0;
        } else {
          for (const x of full) {
            left -= x.get();
            x.set(0);
          }
          open = open.filter((x) => x.get() > 1e-6);
        }
      }
    }
    // the rest of the 60% (if lives are paid up) joins the 30% buyback; 10% stays in the pool
    pool -= pot + (0.9 * payout - pot);
    shares.forEach((s, i) => {
      if (reached[i] === Infinity && backers <= BACKERS_OWED * (1 - s) + 1) reached[i] = e + 1;
    });
  });
  return reached;
}

const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const years = (w: number) => (w === Infinity ? "never (10 yrs+)" : w >= 104 ? `${(w / 52).toFixed(1)} years` : `${w} weeks`);

console.log(`Bootstrap round: $${ROUND.toLocaleString()} backed, Backer Lives owed $${Math.round(BACKERS_OWED).toLocaleString()}`);
console.log(`House keeps 15% of traders' losses on average (as in the fairness simulation), weekly epochs, ${SEEDS} runs each\n`);
const SHARES = [0.25, 0.5, 0.9, 0.99, 1];
for (const rule of ["owed", "remaining"] as const) {
  console.log(rule === "owed" ? "Shared by what each life was originally owed (D-25):" : "\nShared by what each life is still owed (before D-25):");
  for (const weekly of [25_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000]) {
    const runs = Array.from({ length: SEEDS }, (_, i) => run(weekly, 0.15, i + 1, SHARES, rule));
    const cols = SHARES.map((_, k) => runs.map((r) => r[k]));
    const median = cols.map((c) => years(pct(c, 0.5)));
    const slow = years(pct(cols[4], 0.9));
    console.log(
      `  traders lose $${(weekly / 1000).toLocaleString()}K/week (house +$${((weekly * 0.15) / 1000).toFixed(1)}K):`.padEnd(48) +
        `25% paid ${median[0]}, 50% ${median[1]}, 90% ${median[2]}, 99% ${median[3]}, in full ${median[4]} (slowest 10%: ${slow})`,
    );
  }
}
