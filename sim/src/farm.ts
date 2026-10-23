// Wash-trading farm: what $1UP price makes it pay to trade against yourself for emissions?
//
// A farmer opens a long and a short on the same market. One side loses `x`, the other wins `x` and pays
// the house the 10% cut, so the farmer's only cost is 0.1·x USDC, and the house books 0.1·x of profit.
// Under current wallet-net-loss allocation, the farmer is credited only the 0.1·x cut.
// The historical voting rule below deliberately retains the old gross-loss assumption.
//
// Break-even price = cost ÷ $1UP received. Shown as fully diluted value (× 1B supply) to read it as
// "farming pays once $1UP trades above this FDV".

import { flows } from "./model.ts";

const SUPPLY = 1e9;
const SCHEDULE = 900e6 / 208; // $1UP per epoch for 4 years
const CUT = 0.1;
/** Exiting a fresh 104-epoch lock costs 50%. */
const FRESH_LOCK_HAIRCUT = 0.5;

export interface Rules {
  name: string;
  /** $1UP the farmer gets in epoch e, given honest losses L, house net N and farm loss x, plus state. */
  farmerOneup(L: number, N: number, x: number, state: { carry: number }): number;
  /** Fraction of value the farmer keeps if they sell immediately. */
  liquidity: number;
}

/** As built before: per epoch, half the schedule to losers by loss, half to winners by cut paid. */
export const voting: Rules = {
  name: "Before: half to losers by loss, half to winners by cut, liquid",
  farmerOneup: (L, N, x) => {
    const losersHalf = SCHEDULE / 2;
    const winnersHalf = SCHEDULE / 2;
    // honest winners paid cut ≈ house edge share of their profit; approximate honest cuts as 0.1 × payouts
    const honestCuts = CUT * (L - N);
    return losersHalf * (x / (L + x)) + winnersHalf * ((CUT * x) / (honestCuts + CUT * x));
  },
  liquidity: 1,
};

/** New: losers only, release K $1UP per $1 of house profit (capped by schedule + carry), as a fresh lock. */
export function profitRelease(K: number): Rules {
  return {
    name: `Losers only, ${K} $1UP per $1 of house profit, locked`,
    farmerOneup: (L, N, x, state) => {
      const available = state.carry + SCHEDULE;
      const release = Math.min(available, K * Math.max(0, N + CUT * x));
      state.carry = available - release;
      const netLoss = CUT * x;
      return L + netLoss > 0 ? release * (netLoss / (L + netLoss)) : 0;
    },
    liquidity: 1 - FRESH_LOCK_HAIRCUT,
  };
}

/** Break-even FDV for a farmer washing `ratio` × the honest losses each epoch over epochs [from, to). */
export function breakEvenFdv(rules: Rules, ratio: number, from: number, to: number, seed = 1): number {
  const fs = flows({ epochs: to, start: 20_000, peak: 2_000_000, mid: 52, edge: 0.15, seed });
  // carry builds from launch with honest flows only, then the farmer joins at `from`
  const state = { carry: 0 };
  let cost = 0;
  let got = 0;
  for (let e = 0; e < to; e++) {
    const L = fs[e].losses;
    const N = fs[e].losses - fs[e].payouts;
    const x = e >= from ? ratio * L : 0;
    const oneup = rules.farmerOneup(L, N, x, state);
    if (e >= from) {
      cost += CUT * x;
      got += oneup * rules.liquidity;
    }
  }
  return (cost / got) * SUPPLY;
}

const fmt = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(v < 1e7 ? 1 : 0)}M`);

if (import.meta.url === `file://${process.argv[1]}`) {
  const windows: [string, number, number][] = [
    ["first 13 weeks", 0, 13],
    ["year 2", 52, 104],
  ];
  const ratios = [0.1, 1, 10];
  const rules = [voting, profitRelease(100), profitRelease(20), profitRelease(10)];
  console.log("Farming pays once $1UP's fully diluted value is above:\n");
  for (const r of rules) {
    console.log(r.name);
    for (const [label, from, to] of windows) {
      const cells = ratios.map((k) => `${k}× volume ${fmt(breakEvenFdv(r, k, from, to))}`);
      console.log(`  ${label.padEnd(15)} ${cells.join("   ")}`);
    }
  }
}
