// Port of contracts/math (oneup-math) with bigint. Same names, same rounding; see docs/maths.md.
// USDC amounts are 1e6, prices 1e8, rates and multipliers ppm (1e6), $1UP 1e18.

export const PPM = 1_000_000n;
export const USDC = 1_000_000n;
export const ONEUP = 10n ** 18n;
export const PRICE_DECIMALS = 8;

export const PROFIT_CAP = 9n;
export const LIQUIDATION_PPM = 900_000n;
export const CUT_BASE_PPM = 100_000n;
export const CUT_MAX_PPM = 250_000n;

export const RESERVE_PPM = 1_200_000n;
export const MIN_RESERVE = 25_000n * USDC;
export const PAYOUT_PPM = 500_000n;
export const LIVES_SHARE_PPM = 600_000n;
export const BUYBACK_SHARE_PPM = 300_000n;

export const LIFE_CAP_MAX_PPM = 2_000_000n;
export const LIFE_CAP_MIN_PPM = 1_200_000n;
export const LIFE_CAP_POOL = 1_000_000n * USDC;

export const SUPPLY = 1_000_000_000n * ONEUP;
export const EMISSIONS_TOTAL = 900_000_000n * ONEUP;
export const EMISSION_EPOCHS = 208n;
export const VE_MAX_EPOCHS = 104n;
export const EXIT_PENALTY_MAX_PPM = 500_000n;
export const ONEUP_PER_USDC = 20n;

export type Side = "Long" | "Short";

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);
const divCeil = (a: bigint, b: bigint) => (a + b - 1n) / b;
/** Floor division toward −∞ (bigint `/` truncates toward zero). */
const divFloor = (a: bigint, b: bigint) => {
  const q = a / b;
  return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
};

/** Oracle `price × 10^expo` → 1e8 fixed point; null for non-positive prices or absurd exponents. */
export function normalizePrice(price: bigint, expo: number): bigint | null {
  if (price <= 0n || expo < -18 || expo > 18) return null;
  const shift = PRICE_DECIMALS + expo;
  if (shift >= 0) return price * 10n ** BigInt(shift);
  const v = price / 10n ** BigInt(-shift);
  return v > 0n ? v : null;
}

// §1 Positions

/**
 * What the house made or lost on trading in a round: losses and the marketplace's cut, less what it paid winners.
 * The contract's `house_net` is this floored at zero, because it is what Life NFTs and $1UP are sized from; a page
 * that shows the house's result must show the losing rounds as losses.
 */
export const houseResult = (r: { losses: string; payouts: string; fees?: string }) => BigInt(r.losses) + BigInt(r.fees ?? 0) - BigInt(r.payouts);

export const notional = (margin: bigint, leverage: number) => margin * BigInt(leverage);
export const maxLiability = (margin: bigint) => margin * PROFIT_CAP;

export function pnl(side: Side, margin: bigint, leverage: number, entry: bigint, price: bigint): bigint {
  const diff = side === "Long" ? price - entry : entry - price;
  const raw = divFloor(notional(margin, leverage) * diff, entry);
  return max(-margin, min(raw, maxLiability(margin)));
}

export const isLiquidatable = (p: bigint, margin: bigint) =>
  p < 0n && -p * PPM >= margin * LIQUIDATION_PPM;

export const atProfitCap = (p: bigint, margin: bigint) => p >= maxLiability(margin);

export function liquidationPrice(side: Side, entry: bigint, leverage: number): bigint {
  const delta = (entry * LIQUIDATION_PPM) / (PPM * BigInt(leverage));
  return side === "Long" ? max(entry - delta, 0n) : entry + delta;
}

// §3 Solvency

export const marketLiability = (long: bigint, short: bigint, bothSides = true) =>
  bothSides ? long + short : max(long, short);

export const capacity = (sharePpm: bigint, pool: bigint) => (pool * sharePpm) / PPM;

// §4 Winner's cut

export function cutPpm(liability: bigint, pool: bigint): bigint {
  if (pool === 0n) return CUT_MAX_PPM;
  return min(CUT_BASE_PPM + divCeil(liability * PPM, pool * 2n), CUT_MAX_PPM);
}

export const cutAmount = (profit: bigint, ppm: bigint) => divCeil(profit * ppm, PPM);

export interface Settlement {
  toTrader: bigint;
  cut: bigint;
  poolPaid: bigint;
  poolTaken: bigint;
}

export function settle(margin: bigint, p: bigint, ppm: bigint): Settlement {
  if (p > 0n) {
    const cut = cutAmount(p, ppm);
    return { toTrader: margin + p - cut, cut, poolPaid: p - cut, poolTaken: 0n };
  }
  return { toTrader: margin + p, cut: 0n, poolPaid: 0n, poolTaken: -p };
}

// §5 Life NFTs

/** What a round's Lives and $1UP are sized from: house profit, never more than the round's net losses. */
export const recoveryBase = (houseNet: bigint, netLosses: bigint) => min(houseNet > 0n ? houseNet : 0n, netLosses);

/** A loser's share of the recovery base, by net loss: never more than the loss itself. */
export const faceValue = (houseNet: bigint, loss: bigint, losses: bigint) =>
  losses === 0n ? 0n : (recoveryBase(houseNet, losses) * loss) / losses;

export const lifeCapPpm = (pool: bigint) =>
  LIFE_CAP_MAX_PPM - ((LIFE_CAP_MAX_PPM - LIFE_CAP_MIN_PPM) * min(pool, LIFE_CAP_POOL)) / LIFE_CAP_POOL;

export const owed = (face: bigint, capPpm: bigint) => (face * capPpm) / PPM;

// §6 Surplus and payout

/** 1.2× the solvency total, never below the seed (`floor`), so only house profit is ever shared out. */
export const reserve = (liability: bigint, floor = MIN_RESERVE) => max(divCeil(liability * RESERVE_PPM, PPM), floor);

export interface EpochPayout {
  reserve: bigint;
  surplus: bigint;
  livesPot: bigint;
  buybackPot: bigint;
}

export function epochPayout(pool: bigint, liability: bigint, owedRemaining: bigint, floor = MIN_RESERVE): EpochPayout {
  const r = reserve(liability, floor);
  const surplus = max(pool - r, 0n);
  const payout = (surplus * PAYOUT_PPM) / PPM;
  const livesShare = (payout * LIVES_SHARE_PPM) / PPM;
  const livesPot = min(livesShare, owedRemaining);
  const buybackPot = (payout * BUYBACK_SHARE_PPM) / PPM + (livesShare - livesPot);
  return { reserve: r, surplus, livesPot, buybackPot };
}

export const proRata = (amount: bigint, part: bigint, total: bigint) =>
  total === 0n ? 0n : (amount * part) / total;

// §8 Emissions

export function emissionsForEpoch(e: bigint): bigint {
  const per = EMISSIONS_TOTAL / EMISSION_EPOCHS;
  if (e === 0n || e > EMISSION_EPOCHS) return 0n;
  return e < EMISSION_EPOCHS ? per : EMISSIONS_TOTAL - per * (EMISSION_EPOCHS - 1n);
}

// §9 ve1UP

export const vePower = (amount: bigint, epochsLeft: bigint) =>
  (amount * min(epochsLeft, VE_MAX_EPOCHS)) / VE_MAX_EPOCHS;

/** Cost of leaving a lock with `epochsLeft` to run: up to 50% at the full 104, rounded up. */
export const exitPenalty = (amount: bigint, epochsLeft: bigint) => {
  const n = amount * EXIT_PENALTY_MAX_PPM * min(epochsLeft, VE_MAX_EPOCHS);
  const d = PPM * VE_MAX_EPOCHS;
  return (n + d - 1n) / d;
};

/** $1UP released to an epoch's losers: 20 per USDC of `houseNet` (pass the recovery base), at most what's available. */
export const releasedEmissions = (available: bigint, houseNet: bigint, rate = ONEUP_PER_USDC) =>
  min((houseNet > 0n ? houseNet : 0n) * rate * (ONEUP / USDC), available);

/** Current epoch's loser allocation, using the same positive wallet-net-loss denominator as close. */
export function previewLossEmission(epoch: { id: number; losses: string; payouts: string; net_losses: string; fees: string }, carry: bigint, loss: bigint, rate = ONEUP_PER_USDC): bigint {
  const denominator = BigInt(epoch.net_losses);
  const net = recoveryBase(BigInt(epoch.losses) + BigInt(epoch.fees) - BigInt(epoch.payouts), denominator);
  const release = releasedEmissions(carry + emissionsForEpoch(BigInt(epoch.id)), net, rate);
  return denominator > 0n ? release * loss / denominator : 0n;
}

/** Parse a form value exactly into token base units. Invalid or out-of-u128 values disable the action. */
export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 24 || value.length > 80) return 0n;
  const text = value.trim();
  if (!/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(text)) return 0n;
  const [whole, rawFraction = ""] = text.split(".");
  const fraction = rawFraction.replace(/0+$/, "");
  if (fraction.length > decimals) return 0n;
  const raw = BigInt((whole || "0") + fraction.padEnd(decimals, "0"));
  return raw <= (1n << 128n) - 1n ? raw : 0n;
}

// Display helpers

/** 1e6 units → "1,234.56" */
export function fmtUsdc(x: bigint, decimals = 2): string {
  const neg = x < 0n;
  const v = neg ? -x : x;
  const whole = (v / USDC).toLocaleString("en-US");
  const frac = (v % USDC).toString().padStart(6, "0").slice(0, decimals);
  return `${neg ? "-" : ""}${whole}${decimals ? "." + frac : ""}`;
}

/** 1e8 price units → number (display only). */
export const priceToNumber = (p: bigint) => Number(p) / 1e8;

/** ppm → "1.84×" style number. */
export const ppmToNumber = (p: bigint) => Number(p) / 1e6;
export const numberToPrice = (x: number) => Number.isFinite(x) && x > 0 && Number.isFinite(x * 1e8) ? BigInt(Math.round(x * 1e8)) : 0n;

/** Decision D-19: a take-profit fires once the price reaches it in the position's favour, a stop once it
 *  reaches it against. */
export const targetHit = (side: Side, price: bigint, target: bigint) => (side === "Long" ? price >= target : price <= target);
export const stopHit = (side: Side, price: bigint, stop: bigint) => (side === "Long" ? price <= stop : price >= stop);

/** Realized profit actually retained by the trader; legacy loss records may omit the cut. */
export function netTradePnl(trade: { pnl: string; cut?: string }): bigint {
  return BigInt(trade.pnl) - BigInt(trade.cut ?? 0);
}
