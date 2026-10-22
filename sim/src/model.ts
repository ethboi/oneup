// Early vs late traders: OneUp's rules against Papertrade-style rules, on the same trader flows.
//
// Each epoch, traders lose `losses` and winners take `payouts` (after the cut). We follow every epoch's
// losers as a cohort and track the USDC paid back to them over the whole run. Plain floats: this is a model,
// not the contracts (the contracts' exact maths is in contracts/math and its tests).
//
// Papertrade parameters are from its docs (docs.papertrade.xyz, read 2026-10-20): 100 PAPER per $1 of loss
// below $2M tracked LP, then 100·(S/(S+H))² with S = $120M and H the high-water LP gain past $2M; stakers
// get 1% of realised PnL while there's no queue, plus all LP above $5M. Unpaid winners queue as debt.

export interface Flow {
  losses: number;
  payouts: number;
}

export interface Cohort {
  epoch: number;
  lost: number;
  /** USDC paid back to this epoch's losers by the end of the run. */
  recovered: number;
  /** USDC paid to this cohort in each epoch (index = paying epoch). */
  paid: number[];
}

const cohort = (epoch: number, lost: number, n: number): Cohort => ({ epoch, lost, recovered: 0, paid: new Array(n).fill(0) });
const credit = (c: Cohort, e: number, amount: number) => {
  c.recovered += amount;
  c.paid[e] += amount;
};

export interface RunResult {
  /** OneUp with lives expiring (D-13, as the contracts do). */
  oneup: Cohort[];
  /** OneUp as first specified: lives earn until paid. */
  oneupNoExpiry: Cohort[];
  papertrade: Cohort[];
  /** Papertrade-style: share of all PAPER held by the losers of the first 10% of all losses. */
  ptEarlyShare: number;
  /** Peak debt owed to queued Papertrade-style winners. */
  ptPeakQueue: number;
  oneupPool: number[];
  ptLp: number[];
}

/** Seeded PRNG (mulberry32) so runs are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Trader flows: weekly losses grow on an S-curve from `start` to `peak`; the house keeps `edge` of
 * losses on average (cut + liquidations), with noisy weeks where the house loses.
 */
export function flows(opts: { epochs: number; start: number; peak: number; mid: number; edge: number; seed: number }): Flow[] {
  const r = rng(opts.seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  return Array.from({ length: opts.epochs }, (_, e) => {
    const level = opts.start + (opts.peak - opts.start) / (1 + Math.exp(-0.08 * (e - opts.mid)));
    const losses = level * Math.exp(0.3 * gauss());
    const edge = Math.max(-0.6, Math.min(0.6, opts.edge + 0.25 * gauss()));
    return { losses, payouts: losses * (1 - edge) };
  });
}

// OneUp (docs/maths.md §5–6)
/** How each epoch's pot is split across earning lives: "split" is the contracts (D-26: two thirds to losers'
 *  lives, one third to backers', each side by original owed); "owed" is D-25 alone; "remaining" before D-25. */
export type Share = "split" | "owed" | "remaining";

/** Water-filling: the same fraction of each life's original owed, lives that would pass their cap filled and the
 *  rest shared again. Returns what the lives couldn't take. */
function fill<T extends { face: number; remaining: number }>(lives: T[], amount: number, pay: (o: T, x: number) => void): number {
  let left = amount;
  let open = lives.filter((o) => o.remaining > 1e-9);
  while (left > 1e-9 && open.length) {
    const rate = left / open.reduce((s, o) => s + o.face, 0);
    const full = open.filter((o) => o.remaining <= rate * o.face);
    if (full.length === 0) {
      for (const o of open) pay(o, rate * o.face);
      return 0;
    }
    for (const o of full) {
      left -= o.remaining;
      pay(o, o.remaining);
    }
    open = open.filter((o) => o.remaining > 1e-9);
  }
  return left;
}

/**
 * `share`: how each epoch's pot is split across earning lives. "owed" (D-25, the contracts) shares it by what
 * each life was owed when minted, each capped at what it's still owed (any excess goes round again);
 * "remaining" (before D-25) shared it by what each is still owed, so a half-paid life earned half as fast.
 */
export function oneup(fs: Flow[], seed = 25_000, utilisation = 0.5, expiry = Infinity, share: Share = "split"): { cohorts: Cohort[]; pool: number[] } {
  let pool = seed;
  // Each life cohort: what it was owed and what it's still owed. The seed is cohort −1 at 1.0×.
  const owed: { epoch: number; face: number; remaining: number }[] = [{ epoch: -1, face: seed, remaining: seed }];
  const cohorts: Cohort[] = fs.map((f, epoch) => cohort(epoch, f.losses, fs.length));
  const poolSeries: number[] = [];
  fs.forEach((f, e) => {
    pool += f.losses - f.payouts;
    const houseNet = f.losses - f.payouts;
    if (houseNet > 0) {
      const cap = 2.0 - 0.8 * Math.min(pool, 1_000_000) / 1_000_000;
      owed.push({ epoch: e, face: houseNet * cap, remaining: houseNet * cap });
    }
    const liability = utilisation * pool;
    const reserve = Math.max(1.2 * liability, seed);
    const payout = 0.5 * Math.max(0, pool - reserve);
    // lives older than `expiry` epochs stop earning (the seed never expires)
    for (const o of owed) if (o.epoch >= 0 && e - o.epoch > expiry) o.remaining = 0;
    const totalOwed = owed.reduce((s, o) => s + o.remaining, 0);
    const pot = Math.min(0.6 * payout, totalOwed);
    const buyback = 0.3 * payout + (0.6 * payout - pot);
    const pay = (o: (typeof owed)[number], amount: number) => {
      o.remaining -= amount;
      if (o.epoch >= 0) credit(cohorts[o.epoch], e, amount);
    };
    if (pot > 0 && share === "remaining") {
      for (const o of owed) pay(o, (pot * o.remaining) / totalOwed);
    } else if (pot > 0 && share === "owed") {
      fill(owed, pot, pay);
    } else if (pot > 0) {
      // D-26: two thirds to losers' lives, one third to the seed's (backers'); each passes on what it can't use
      const losers = owed.filter((o) => o.epoch >= 0);
      const backers = owed.filter((o) => o.epoch < 0);
      const slice = (pot * 2) / 3;
      const lLeft = fill(losers, slice, pay);
      const bLeft = fill(backers, pot - slice, pay);
      fill(backers, lLeft, pay);
      fill(losers, bLeft, pay);
    }
    pool -= pot + buyback;
    poolSeries.push(pool);
  });
  return { cohorts, pool: poolSeries };
}

// Papertrade-style
export function papertrade(fs: Flow[], seed = 25_000) {
  const THRESHOLD = 2_000_000;
  const S = 120_000_000;
  const STAKER_CAP = 5_000_000;
  let lp = seed;
  let high = 0; // H: high-water LP gain past the threshold
  let queue = 0;
  let peakQueue = 0;
  const minted: number[] = [];
  const cohorts: Cohort[] = fs.map((f, epoch) => cohort(epoch, f.losses, fs.length));
  const lpSeries: number[] = [];

  fs.forEach((f, e) => {
    const rate = lp < THRESHOLD ? 100 : 100 * (S / (S + high)) ** 2;
    minted[e] = rate * f.losses;
    // losses fill the LP and pay down the queue first; winners are paid from the LP or queue as debt
    lp += f.losses;
    const repay = Math.min(queue, Math.max(0, lp));
    queue -= repay;
    lp -= repay;
    lp -= f.payouts;
    if (lp < 0) {
      queue += -lp;
      lp = 0;
    }
    peakQueue = Math.max(peakQueue, queue);
    if (lp > THRESHOLD) high = Math.max(high, lp - THRESHOLD);

    // distributions: 1% of realised PnL while no queue, plus everything above the staker cap
    let dist = 0;
    if (queue === 0) dist += Math.min(lp, 0.01 * (f.losses + f.payouts));
    lp -= dist;
    if (lp > STAKER_CAP) {
      dist += lp - STAKER_CAP;
      lp = STAKER_CAP;
    }
    const supply = minted.reduce((a, b) => a + b, 0);
    if (dist > 0 && supply > 0) for (let c = 0; c <= e; c++) credit(cohorts[c], e, (dist * minted[c]) / supply);
    lpSeries.push(lp);
  });

  // share of supply held by the losers of the first 10% of all losses
  const total = fs.reduce((s, f) => s + f.losses, 0);
  let acc = 0;
  let early = 0;
  for (let e = 0; e < fs.length && acc < 0.1 * total; e++) {
    const take = Math.min(fs[e].losses, 0.1 * total - acc);
    early += (minted[e] * take) / fs[e].losses;
    acc += take;
  }
  const supply = minted.reduce((a, b) => a + b, 0);
  return { cohorts, earlyShare: early / supply, peakQueue, lp: lpSeries };
}

export const LIFE_EXPIRY_EPOCHS = 13;

export function run(fs: Flow[], seed = 25_000, expiry = LIFE_EXPIRY_EPOCHS, share: Share = "split"): RunResult {
  const o = oneup(fs, seed, 0.5, expiry, share);
  const n = oneup(fs, seed, 0.5, Infinity, share);
  const p = papertrade(fs, seed);
  return { oneup: o.cohorts, oneupNoExpiry: n.cohorts, papertrade: p.cohorts, ptEarlyShare: p.earlyShare, ptPeakQueue: p.peakQueue, oneupPool: o.pool, ptLp: p.lp };
}

/** Recovery per $1 lost for each quarter of the run, by when the loss happened. */
export function byQuarter(cohorts: Cohort[]): number[] {
  const n = cohorts.length;
  return [0, 1, 2, 3].map((q) => {
    const slice = cohorts.slice(Math.floor((q * n) / 4), Math.floor(((q + 1) * n) / 4));
    return slice.reduce((s, c) => s + c.recovered, 0) / slice.reduce((s, c) => s + c.lost, 0);
  });
}

/** Recovery per $1 lost within `window` epochs of the loss, for each quarter of the first `n` epochs. */
export function windowedByQuarter(cohorts: Cohort[], n: number, window: number): number[] {
  return [0, 1, 2, 3].map((q) => {
    const slice = cohorts.slice(Math.floor((q * n) / 4), Math.floor(((q + 1) * n) / 4));
    const got = slice.reduce((s, c) => s + c.paid.slice(c.epoch, c.epoch + window + 1).reduce((a, b) => a + b, 0), 0);
    return got / slice.reduce((s, c) => s + c.lost, 0);
  });
}

/** Of everything paid out during epochs [from, to), the share that went to losers from epochs [0, early). */
export function earlyShareOfPayouts(cohorts: Cohort[], early: number, from: number, to: number): number {
  let all = 0;
  let toEarly = 0;
  for (const c of cohorts) {
    const got = c.paid.slice(from, to).reduce((a, b) => a + b, 0);
    all += got;
    if (c.epoch < early) toEarly += got;
  }
  return all ? toEarly / all : 0;
}
