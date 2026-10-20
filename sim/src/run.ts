// `pnpm sim`: runs the model and writes sim/out/results.json (the app's Simulation view reads it).

import { mkdirSync, writeFileSync } from "node:fs";
import { fairnessSvg } from "./svg.ts";
import { resolve } from "node:path";
import { LIFE_EXPIRY_EPOCHS, earlyShareOfPayouts, flows, run, windowedByQuarter, type Cohort } from "./model.ts";

const MEASURED = 156; // three years of weekly epochs are compared
const WINDOW = 52; // each loss is followed for a year...
const EPOCHS = MEASURED + WINDOW; // ...so the run continues a year past the last measured loss
const SEEDS = 20;
const params = { epochs: EPOCHS, start: 20_000, peak: 2_000_000, mid: 52, edge: 0.15 };

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const runs = Array.from({ length: SEEDS }, (_, i) => {
  const fs = flows({ ...params, seed: i + 1 });
  const r = run(fs);
  const year1 = fs.slice(0, 52).reduce((s, f) => s + f.losses, 0);
  const all = fs.slice(0, 156).reduce((s, f) => s + f.losses, 0);
  return {
    r,
    oneup: windowedByQuarter(r.oneup, MEASURED, WINDOW),
    oneupNoExpiry: windowedByQuarter(r.oneupNoExpiry, MEASURED, WINDOW),
    papertrade: windowedByQuarter(r.papertrade, MEASURED, WINDOW),
    // of year-3 payouts, the share going to year-1 losers
    y1ShareOfY3: { oneup: earlyShareOfPayouts(r.oneup, 52, 104, 156), papertrade: earlyShareOfPayouts(r.papertrade, 52, 104, 156) },
    y1ShareOfLosses: year1 / all,
    early: r.ptEarlyShare,
  };
});
const q = (k: "oneup" | "oneupNoExpiry" | "papertrade") => [0, 1, 2, 3].map((i) => median(runs.map((x) => x[k][i])));
const headline = runs[0].r;

const out = {
  params: { ...params, measured: MEASURED, window: WINDOW, seeds: SEEDS, seed: 25_000, utilisation: 0.5, lifeExpiryEpochs: LIFE_EXPIRY_EPOCHS },
  // USDC recovered within a year per $1 lost, by when the loss happened: 13-week buckets, median of seeds
  series: Array.from({ length: MEASURED / 13 }, (_, b) => {
    const per = (cs: Cohort[]) => {
      const sl = cs.slice(b * 13, (b + 1) * 13);
      const got = sl.reduce((s, c) => s + c.paid.slice(c.epoch, c.epoch + WINDOW + 1).reduce((a, x) => a + x, 0), 0);
      return got / sl.reduce((s, c) => s + c.lost, 0);
    };
    const med = (k: "oneup" | "oneupNoExpiry" | "papertrade") => median(runs.map((x) => per(x.r[k])));
    return { week: b * 13 + 1, oneup: med("oneup"), oneupNoExpiry: med("oneupNoExpiry"), papertrade: med("papertrade") };
  }),
  quarters: { oneup: q("oneup"), oneupNoExpiry: q("oneupNoExpiry"), papertrade: q("papertrade") },
  y1ShareOfY3: {
    oneup: median(runs.map((x) => x.y1ShareOfY3.oneup)),
    papertrade: median(runs.map((x) => x.y1ShareOfY3.papertrade)),
    losses: median(runs.map((x) => x.y1ShareOfLosses)),
  },
  ptEarlyShare: median(runs.map((x) => x.early)),
  ptPeakQueue: headline.ptPeakQueue,
};

const dir = resolve(import.meta.dirname, "../out");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "results.json"), JSON.stringify(out, null, 2));
writeFileSync(resolve(import.meta.dirname, "../../docs/fairness.svg"), fairnessSvg(out.series));

const c = (x: number) => `${(x * 100).toFixed(1)}¢`;
const p = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`USDC back within a year per $1 lost, by quarter of years 1–3 (median of ${SEEDS} seeds):`);
console.log(`  OneUp (lives expire after ${LIFE_EXPIRY_EPOCHS})`.padEnd(32), out.quarters.oneup.map(c).join("  "));
console.log("  OneUp (no expiry, first spec)".padEnd(32), out.quarters.oneupNoExpiry.map(c).join("  "));
console.log("  Papertrade-style".padEnd(32), out.quarters.papertrade.map(c).join("  "));
console.log(`Year-3 payouts going to year-1 losers: OneUp ${p(out.y1ShareOfY3.oneup)}, Papertrade-style ${p(out.y1ShareOfY3.papertrade)} (year 1 was ${p(out.y1ShareOfY3.losses)} of all losses)`);
console.log(`Papertrade-style: the first 10% of losses hold ${p(out.ptEarlyShare)} of PAPER`);
console.log(`Peak queued winner debt (headline run): $${Math.round(out.ptPeakQueue).toLocaleString("en-US")}`);
