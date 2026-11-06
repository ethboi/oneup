// Aggregate-flow sensitivity, not a price forecast or contract/admission/solvency simulation.
import { flows, oneup, windowedByQuarter } from "./model.ts";
import { breakEvenFdv, profitRelease } from "./farm.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function bootstrap(own: number, contributions: number[]) {
  let pool = own, owed = own;
  const cap = (x: number) => 2 - .8 * Math.min(x, 1_000_000) / 1_000_000;
  for (const amount of contributions) {
    const curved = Math.max(0, Math.min(amount, 1_000_000 - pool));
    owed += curved * (cap(pool) + cap(pool + curved)) / 2 + (amount - curved) * 1.2;
    pool += amount;
  }
  return { pool, owed };
}
const actual = bootstrap(250_000, [60_000, 40_000]);
export const scenarios = [
  { name: "Historical growing illustration", start: 20_000, peak: 2_000_000, edge: .15, utilisation: .5, seed: 25_000, owed: 25_000 },
  { name: "Growing, deployment bootstrap", start: 20_000, peak: 2_000_000, edge: .15, utilisation: .5, seed: actual.pool, owed: actual.owed },
  { name: "Flat low activity", start: 25_000, peak: 25_000, edge: .15, utilisation: .5, seed: actual.pool, owed: actual.owed },
  { name: "Declining activity", start: 250_000, peak: 25_000, edge: .15, utilisation: .5, seed: actual.pool, owed: actual.owed },
  { name: "Lower house edge", start: 100_000, peak: 100_000, edge: .03, utilisation: .5, seed: actual.pool, owed: actual.owed },
  { name: "Negative house edge", start: 100_000, peak: 100_000, edge: -.05, utilisation: .5, seed: actual.pool, owed: actual.owed },
  { name: "High utilisation", start: 100_000, peak: 100_000, edge: .15, utilisation: .9, seed: actual.pool, owed: actual.owed },
  { name: "Larger bootstrap", start: 100_000, peak: 100_000, edge: .15, utilisation: .5, seed: 1_000_000, owed: bootstrap(250_000, [750_000]).owed },
];
const range = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1)! };
};
export function sensitivity(seeds = 20) {
  return scenarios.map(s => {
    const runs = Array.from({length: seeds}, (_, i) => {
      const fs = flows({ epochs: 208, start: s.start, peak: s.peak, mid: 52, edge: s.edge, seed: i + 1 });
      const r = oneup(fs, s.seed, s.utilisation, 13, "split", s.owed);
      const q = windowedByQuarter(r.cohorts, 156, 52);
      const recovered = r.cohorts.reduce((sum, c) => sum + c.recovered, 0);
      const losses = fs.reduce((sum, f) => sum + f.losses, 0);
      return {
        recoveryPerDollar: recovered / losses,
        earlyLateRatio: q[3] > 0 ? q[0] / q[3] : null,
        expiredUnpaidCaps: r.expiredUnpaid, outstandingCaps: r.outstandingCaps,
        backerRecovery: r.backerPaid / r.backerOwed,
        cashDeficit: Math.max(0, -Math.min(...r.pool)),
      };
    });
    return { assumptions: s, seeds,
      recoveryPerDollar: range(runs.map(r => r.recoveryPerDollar)),
      earlyLateRatio: runs.every(r => r.earlyLateRatio === null) ? null : range(runs.flatMap(r => r.earlyLateRatio === null ? [] : [r.earlyLateRatio])),
      infeasibleRuns: runs.filter(r => r.cashDeficit > 0).length,
      undefinedRatios: runs.filter(r => r.earlyLateRatio === null).length,
      expiredUnpaidCaps: range(runs.map(r => r.expiredUnpaidCaps)), outstandingCaps: range(runs.map(r => r.outstandingCaps)),
      backerRecovery: range(runs.map(r => r.backerRecovery)), cashDeficit: range(runs.map(r => r.cashDeficit)),
    };
  });
}
export function farmingScenarios() {
  return ["same", "separate"].flatMap(wallets => [.1, .5, 1].map(liquidity => ({ wallets, liquidity,
    extraLifeRecovery: "excluded; reduces actual farming cost if received",
    breakEvenFdv: breakEvenFdv(profitRelease(20, wallets as "same" | "separate", liquidity), 1, 0, 13),
  })));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = { limitations: "Synthetic aggregate flows with exogenous edge/utilisation. Negative cash is an infeasible flow assumption, not an executable contract insolvency. No order admission or strategy model. Ranges are min/median/max across seeds, not confidence intervals. Farming excludes capital timing, admission and Life NFT proceeds; lock sale discounts are assumed, not observed.", scenarios: sensitivity(), farming: farmingScenarios() };
  const dir = resolve(import.meta.dirname, "../out"); mkdirSync(dir, {recursive: true});
  writeFileSync(resolve(dir, "sensitivity.json"), JSON.stringify(result, null, 2));
  console.table(result.scenarios.map(r => ({ scenario: r.assumptions.name, recovery: r.recoveryPerDollar.median.toFixed(4), backerRecovery: r.backerRecovery.median.toFixed(4), expiredUnpaid: Math.round(r.expiredUnpaidCaps.median), cashDeficit: Math.round(r.cashDeficit.max) })));
  console.table(result.farming);
}
