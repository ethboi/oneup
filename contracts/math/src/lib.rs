//! OneUp maths, shared by every contract and mirrored in `packages/sdk`.
//! Formulas and units follow `docs/maths.md`; section numbers below refer to it.
//!
//! USDC amounts are 1e6, prices 1e8, rates/multipliers ppm (1e6).
//! Amounts paid out of the house round down; amounts owed to it round up.

pub const PPM: u128 = 1_000_000;
pub const PRICE_DECIMALS: i32 = 8;
pub const USDC: u128 = 1_000_000;

pub const PROFIT_CAP: u128 = 9;
pub const LIQUIDATION_PPM: u128 = 900_000;
pub const CUT_BASE_PPM: u128 = 100_000;
pub const CUT_MAX_PPM: u128 = 250_000;

pub const RESERVE_PPM: u128 = 1_200_000;
/// The spec's seed. The reserve floor is the seed actually deposited (see `reserve`).
pub const MIN_RESERVE: u128 = 25_000 * USDC;
pub const PAYOUT_PPM: u128 = 500_000;
pub const LIVES_SHARE_PPM: u128 = 600_000;
pub const BUYBACK_SHARE_PPM: u128 = 300_000;

pub const LIFE_CAP_MAX_PPM: u128 = 2_000_000;
pub const LIFE_CAP_MIN_PPM: u128 = 1_200_000;
pub const LIFE_CAP_POOL: u128 = 1_000_000 * USDC;

pub const ONEUP: u128 = 1_000_000_000_000_000_000;
pub const SUPPLY: u128 = 1_000_000_000 * ONEUP;
pub const EMISSIONS_TOTAL: u128 = 900_000_000 * ONEUP;
pub const EMISSION_EPOCHS: u64 = 208;
/// Longest lock: two years of weekly epochs (D-15). Losers' $1UP arrives locked this long (D-16).
pub const VE_MAX_EPOCHS: u64 = 104;
/// Exiting a lock early costs up to half of it, in proportion to the time left (D-15).
pub const EXIT_PENALTY_MAX_PPM: u128 = 500_000;
/// $1UP released per USDC of house profit (D-16), before the cap of schedule + carry.
pub const ONEUP_PER_USDC: u128 = 20;
/// D-22: the smallest backing.
pub const MIN_BACKING: u128 = 10 * USDC;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Long,
    Short,
}

fn div_ceil(a: u128, b: u128) -> u128 {
    a.div_ceil(b)
}

/// Oracle `price × 10^expo` → 1e8 fixed point. `None` for non-positive prices or absurd exponents.
pub fn normalize_price(price: i64, expo: i32) -> Option<u128> {
    if price <= 0 || !(-18..=18).contains(&expo) {
        return None;
    }
    let p = price as u128;
    let shift = PRICE_DECIMALS + expo;
    if shift >= 0 {
        p.checked_mul(10u128.pow(shift as u32))
    } else {
        let v = p / 10u128.pow((-shift) as u32);
        (v > 0).then_some(v)
    }
}

// §1 Positions

pub fn notional(margin: u128, leverage: u32) -> u128 {
    margin * leverage as u128
}

/// Max the house can owe a position: the profit cap.
pub fn max_liability(margin: u128) -> u128 {
    margin * PROFIT_CAP
}

/// PnL clamped to [−margin, 9 × margin]. Floors toward −∞, so losses round up and profits down.
pub fn pnl(side: Side, margin: u128, leverage: u32, entry: u128, price: u128) -> i128 {
    let n = notional(margin, leverage) as i128;
    let diff = match side {
        Side::Long => price as i128 - entry as i128,
        Side::Short => entry as i128 - price as i128,
    };
    let raw = (n * diff).div_euclid(entry as i128);
    raw.clamp(-(margin as i128), max_liability(margin) as i128)
}

pub fn is_liquidatable(pnl: i128, margin: u128) -> bool {
    pnl < 0 && (pnl.unsigned_abs()) * PPM >= margin * LIQUIDATION_PPM
}

pub fn at_profit_cap(pnl: i128, margin: u128) -> bool {
    pnl >= max_liability(margin) as i128
}

/// A take-profit is hit once the price reaches it in the position's favour (decision D-19).
pub fn target_hit(side: Side, price: u128, target: u128) -> bool {
    match side {
        Side::Long => price >= target,
        Side::Short => price <= target,
    }
}

/// A stop-loss is hit once the price reaches it against the position.
pub fn stop_hit(side: Side, price: u128, stop: u128) -> bool {
    match side {
        Side::Long => price <= stop,
        Side::Short => price >= stop,
    }
}

/// `P0 × (1 ∓ 0.9 / k)` in 1e8 price units.
pub fn liquidation_price(side: Side, entry: u128, leverage: u32) -> u128 {
    let k = leverage as u128;
    let delta = entry * LIQUIDATION_PPM / (PPM * k);
    match side {
        Side::Long => entry.saturating_sub(delta),
        Side::Short => entry + delta,
    }
}

// §3 Solvency

/// A market's liability. `both_sides` is decision D-1 (recommended); otherwise the spec's bigger side.
pub fn market_liability(long_liab: u128, short_liab: u128, both_sides: bool) -> u128 {
    if both_sides {
        long_liab + short_liab
    } else {
        long_liab.max(short_liab)
    }
}

pub fn capacity(vote_share_ppm: u128, pool: u128) -> u128 {
    pool * vote_share_ppm / PPM
}

// §4 Winner's cut

/// `min(25%, 10% + u/2)`, `u = liability / pool`. Rounded up (owed to the house).
pub fn cut_ppm(liability: u128, pool: u128) -> u128 {
    if pool == 0 {
        return CUT_MAX_PPM;
    }
    let half_u = div_ceil(liability * PPM, pool * 2);
    (CUT_BASE_PPM + half_u).min(CUT_MAX_PPM)
}

pub fn cut_amount(profit: u128, cut_ppm: u128) -> u128 {
    div_ceil(profit * cut_ppm, PPM)
}

/// What a closing position returns to the trader, and the pool's change.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Settlement {
    pub to_trader: u128,
    pub cut: u128,
    /// Profit paid by the pool (after the cut). 0 for a loss.
    pub pool_paid: u128,
    /// Loss taken by the pool. 0 for a win.
    pub pool_taken: u128,
}

pub fn settle(margin: u128, pnl: i128, cut_ppm: u128) -> Settlement {
    if pnl > 0 {
        let profit = pnl as u128;
        let cut = cut_amount(profit, cut_ppm);
        Settlement { to_trader: margin + profit - cut, cut, pool_paid: profit - cut, pool_taken: 0 }
    } else {
        let loss = pnl.unsigned_abs();
        Settlement { to_trader: margin - loss, cut: 0, pool_paid: 0, pool_taken: loss }
    }
}

/// Liquidation: the full margin goes to the pool.
pub fn settle_liquidation(margin: u128) -> Settlement {
    Settlement { to_trader: 0, cut: 0, pool_paid: 0, pool_taken: margin }
}

// §5 Life NFTs

/// What a round's Life NFTs and $1UP are sized from: the house's net result, but never more than the round's
/// net losses. Marketplace fees count as house profit (D-28); in a quiet round they could otherwise make a Life
/// worth more than the loss behind it. Anything above stays in the pool.
pub fn recovery_base(house_net: u128, net_losses: u128) -> u128 {
    house_net.min(net_losses)
}

/// A loser's share of the round's recovery base, by net loss: never more than the loss itself.
pub fn face_value(house_net: u128, loss: u128, losses: u128) -> u128 {
    if losses == 0 {
        return 0;
    }
    recovery_base(house_net, losses) * loss / losses
}

/// 2.0× at an empty pool, falling linearly to 1.2× at $1M and flat after.
pub fn life_cap_ppm(pool: u128) -> u128 {
    let p = pool.min(LIFE_CAP_POOL);
    LIFE_CAP_MAX_PPM - (LIFE_CAP_MAX_PPM - LIFE_CAP_MIN_PPM) * p / LIFE_CAP_POOL
}

/// A Backer Life's cap for backing `amount` into a pool of `pool` (D-22): the average of
/// `life_cap_ppm` over the pool sizes the backing spans, so early dollars earn more and splitting a backing
/// into pieces earns the same. Rounded down.
pub fn backer_cap_ppm(pool: u128, amount: u128) -> u128 {
    if amount == 0 {
        return life_cap_ppm(pool);
    }
    let (a, b) = (pool, pool + amount);
    // over the sloped part [a, min(b, P)] the average is the cap at the midpoint; above P it's the floor
    let top = b.min(LIFE_CAP_POOL);
    let sloped = top.saturating_sub(a);
    let sloped_sum = if sloped > 0 {
        let mid2 = a + top; // twice the midpoint
        let avg2 = 2 * LIFE_CAP_MAX_PPM - mul_div_ceil(LIFE_CAP_MAX_PPM - LIFE_CAP_MIN_PPM, mid2, LIFE_CAP_POOL);
        mul_div(avg2, sloped, 2)
    } else {
        0
    };
    (sloped_sum + LIFE_CAP_MIN_PPM * (amount - sloped)) / amount
}

pub fn owed(face: u128, cap_ppm: u128) -> u128 {
    face * cap_ppm / PPM
}

// §6 Surplus and payout

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EpochPayout {
    pub reserve: u128,
    pub surplus: u128,
    pub lives_pot: u128,
    pub buyback_pot: u128,
}

/// 1.2× the solvency total, never below the seed (`floor`), so only house profit is ever shared out.
pub fn reserve(liability: u128, floor: u128) -> u128 {
    div_ceil(liability * RESERVE_PPM, PPM).max(floor)
}

pub fn epoch_payout(pool: u128, liability: u128, owed_remaining: u128, floor: u128) -> EpochPayout {
    let reserve = reserve(liability, floor);
    let surplus = pool.saturating_sub(reserve);
    let payout = surplus * PAYOUT_PPM / PPM;
    let lives_share = payout * LIVES_SHARE_PPM / PPM;
    let lives_pot = lives_share.min(owed_remaining);
    let buyback_pot = payout * BUYBACK_SHARE_PPM / PPM + (lives_share - lives_pot);
    EpochPayout { reserve, surplus, lives_pot, buyback_pot }
}

/// One Life NFT's share of the pot, pro rata to what it is still owed.
pub fn life_payment(lives_pot: u128, owed_remaining: u128, total_owed_remaining: u128) -> u128 {
    if total_owed_remaining == 0 {
        return 0;
    }
    lives_pot * owed_remaining / total_owed_remaining
}

/// Pro-rata helper used by buybacks (§7), emissions (§8) and ve rewards. 256-bit intermediate: $1UP
/// amounts times ve power overflow u128.
pub fn pro_rata(amount: u128, part: u128, total: u128) -> u128 {
    if total == 0 {
        return 0;
    }
    mul_div(amount, part, total)
}

// §8 Emissions

/// $1UP for epoch `e` (1-based). Epoch 208 also gets the rounding remainder; later epochs get 0.
pub fn emissions_for_epoch(e: u64) -> u128 {
    let per = EMISSIONS_TOTAL / EMISSION_EPOCHS as u128;
    match e {
        0 => 0,
        e if e < EMISSION_EPOCHS => per,
        e if e == EMISSION_EPOCHS => EMISSIONS_TOTAL - per * (EMISSION_EPOCHS as u128 - 1),
        _ => 0,
    }
}

/// $1UP released to an epoch's losers (D-16): `rate` $1UP per USDC of house profit, capped by what's
/// available (this epoch's schedule plus anything unreleased before). The rest carries forward.
pub fn released_emissions(available: u128, house_net: u128, rate: u128) -> u128 {
    // house_net is 1e6 USDC; $1UP is 1e18
    let wanted = house_net.saturating_mul(rate).saturating_mul(ONEUP / USDC);
    wanted.min(available)
}

// §9 ve1UP

pub fn ve_power(amount: u128, epochs_left: u64) -> u128 {
    mul_div(amount, epochs_left.min(VE_MAX_EPOCHS) as u128, VE_MAX_EPOCHS as u128)
}

/// Cost of leaving a lock with `epochs_left` to run: up to 50% at the full 104, rounded up (it's kept by
/// the remaining lockers).
pub fn exit_penalty(amount: u128, epochs_left: u64) -> u128 {
    mul_div_ceil(amount, EXIT_PENALTY_MAX_PPM * epochs_left.min(VE_MAX_EPOCHS) as u128, PPM * VE_MAX_EPOCHS as u128)
}

/// `floor(a × b / c)` with a 256-bit intermediate. Panics if the result doesn't fit in u128.
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    let (hi, lo) = mul_wide(a, b);
    div_wide(hi, lo, c).0
}

/// `ceil(a × b / c)` with a 256-bit intermediate.
pub fn mul_div_ceil(a: u128, b: u128, c: u128) -> u128 {
    let (hi, lo) = mul_wide(a, b);
    let (q, r) = div_wide(hi, lo, c);
    if r > 0 { q + 1 } else { q }
}

fn mul_wide(a: u128, b: u128) -> (u128, u128) {
    let (a1, a0) = (a >> 64, a & u64::MAX as u128);
    let (b1, b0) = (b >> 64, b & u64::MAX as u128);
    let p00 = a0 * b0;
    let p01 = a0 * b1;
    let p10 = a1 * b0;
    let p11 = a1 * b1;
    let mid = (p00 >> 64) + (p01 & u64::MAX as u128) + (p10 & u64::MAX as u128);
    let lo = (p00 & u64::MAX as u128) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    (hi, lo)
}

/// (hi·2^128 + lo) / d by shift-subtract. Panics if the quotient overflows u128.
fn div_wide(hi: u128, lo: u128, d: u128) -> (u128, u128) {
    assert!(d > 0 && hi < d, "mul_div overflow");
    if hi == 0 {
        return (lo / d, lo % d);
    }
    let (mut rem, mut q) = (hi, 0u128);
    for i in (0..128).rev() {
        let carry = rem >> 127;
        rem = (rem << 1) | ((lo >> i) & 1);
        q <<= 1;
        if carry == 1 || rem >= d {
            rem = rem.wrapping_sub(d);
            q |= 1;
        }
    }
    (q, rem)
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn usd(x: u128) -> u128 {
        x * USDC
    }
    const fn px(cents: u128) -> u128 {
        cents * 1_000_000 // 0.01 in 1e8 units
    }

    #[test]
    fn wide_maths() {
        assert_eq!(mul_div_ceil(u128::MAX, 3, 3), u128::MAX);
        assert_eq!(mul_div_ceil(10u128.pow(30), 10u128.pow(18), 10u128.pow(20)), 10u128.pow(28));
        assert_eq!(mul_div_ceil(7, 1, 2), 4);
        assert_eq!(mul_div(7, 1, 2), 3);
        // $1UP reward × ve power: 1e24 × 1e22 / 1e22
        assert_eq!(pro_rata(10u128.pow(24), 10u128.pow(22), 10u128.pow(22)), 10u128.pow(24));
    }

    #[test]
    fn normalize() {
        assert_eq!(normalize_price(106_023_333, -8), Some(106_023_333));
        assert_eq!(normalize_price(1_060, -3), Some(106_000_000));
        assert_eq!(normalize_price(-1, -8), None);
        assert_eq!(normalize_price(1, -12), None);
    }

    #[test]
    fn v1_extra_life_sizing() {
        let house_net = usd(300_000) - usd(200_000);
        let face = face_value(house_net, usd(3_000), usd(300_000));
        assert_eq!(face, usd(1_000));
        let cap = life_cap_ppm(usd(200_000));
        assert_eq!(cap, 1_840_000);
        assert_eq!(owed(face, cap), usd(1_840));
        assert_eq!(life_cap_ppm(0), 2_000_000);
        assert_eq!(life_cap_ppm(usd(5_000_000)), 1_200_000);
    }

    #[test]
    fn fees_cannot_make_a_life_worth_more_than_its_loss() {
        // a quiet round: 1 USDC of net loss and 1_000 USDC of marketplace fees
        assert_eq!(face_value(usd(1_001), usd(1), usd(1)), usd(1));
        // two losers share a base capped at their losses
        assert_eq!(face_value(usd(5_000), usd(300), usd(400)), usd(300));
        assert_eq!(face_value(usd(5_000), usd(100), usd(400)), usd(100));
        // the $1UP release uses the same base
        assert_eq!(recovery_base(usd(1_001), usd(1)), usd(1));
        assert_eq!(released_emissions(EMISSIONS_TOTAL, recovery_base(usd(1_001), usd(1)), 20), 20 * ONEUP);
        // below the net losses nothing changes
        assert_eq!(recovery_base(usd(100_000), usd(300_000)), usd(100_000));
    }

    #[test]
    fn v2_pnl_and_liquidation() {
        let (m, k, entry) = (usd(1_000), 50, px(500));
        assert_eq!(pnl(Side::Long, m, k, entry, px(540)), usd(4_000) as i128);
        assert_eq!(pnl(Side::Long, m, k, entry, px(600)), usd(9_000) as i128);
        assert_eq!(pnl(Side::Short, m, k, entry, px(600)), -(usd(1_000) as i128));
        assert_eq!(liquidation_price(Side::Long, entry, k), px(491));
        assert_eq!(liquidation_price(Side::Short, entry, k), px(509));
        let at_liq = pnl(Side::Long, m, k, entry, px(491));
        assert!(is_liquidatable(at_liq, m));
        assert!(!is_liquidatable(pnl(Side::Long, m, k, entry, px(492)), m));
    }

    #[test]
    fn losses_round_against_the_trader() {
        // 1 unit of notional over a price that doesn't divide evenly
        let p = pnl(Side::Long, 3, 1, 7, 6);
        assert_eq!(p, -1);
        let p = pnl(Side::Long, 3, 1, 7, 8);
        assert_eq!(p, 0);
    }

    #[test]
    fn v3_winners_cut() {
        let cut = cut_ppm(max_liability(usd(1_000)), usd(100_000));
        assert_eq!(cut, 145_000);
        let s = settle(usd(1_000), usd(5_000) as i128, cut);
        assert_eq!(s.cut, usd(725));
        assert_eq!(s.to_trader, usd(5_275));
        assert_eq!(s.pool_paid, usd(4_275));
        assert_eq!(cut_ppm(max_liability(usd(4_000)), usd(100_000)), CUT_MAX_PPM);
    }

    #[test]
    fn v4_solvency_rules() {
        let pool = usd(25_000);
        let long = max_liability(usd(2_000)) + max_liability(usd(300));
        let short = max_liability(usd(500));
        assert!(market_liability(long, short, true) > pool);
        assert_eq!(market_liability(long, short, false), usd(20_700));
    }

    #[test]
    fn seed_above_profit_is_not_surplus() {
        // a 1M seed with 500 of house profit: only the 500 is surplus
        let p = epoch_payout(usd(1_000_500), 0, usd(1_000_000), usd(1_000_000));
        assert_eq!(p.surplus, usd(500));
        assert_eq!(p.lives_pot, usd(150));
        assert_eq!(p.buyback_pot, usd(75));
    }

    #[test]
    fn v5_epoch_payout() {
        let owed_total = usd(1_840) + usd(10_000) + usd(25_000);
        let p = epoch_payout(usd(200_000), usd(50_000), owed_total, MIN_RESERVE);
        assert_eq!(p.reserve, usd(60_000));
        assert_eq!(p.surplus, usd(140_000));
        assert_eq!(p.lives_pot, usd(36_840));
        assert_eq!(p.buyback_pot, usd(26_160));
        assert_eq!(usd(200_000) - p.lives_pot - p.buyback_pot, usd(137_000));

        let p = epoch_payout(usd(120_000), usd(50_000), owed_total, MIN_RESERVE);
        assert_eq!(p.lives_pot, usd(18_000));
        assert_eq!(p.buyback_pot, usd(9_000));
        // Per-life loser/backer allocation is covered through the actual ExtraLife contract V5 test.
    }

    #[test]
    fn v6_emissions() {
        let per = emissions_for_epoch(1);
        assert_eq!(per, 4_326_923_076_923_076_923_076_923);
        let released = released_emissions(per, usd(1_350), 20);
        assert_eq!(released, 27_000 * ONEUP);
        assert_eq!(pro_rata(released, usd(1_000), usd(1_500)), 18_000 * ONEUP);
        assert_eq!(pro_rata(released, usd(500), usd(1_500)), 9_000 * ONEUP);
        let total: u128 = (1..=EMISSION_EPOCHS).map(emissions_for_epoch).sum();
        assert_eq!(total, EMISSIONS_TOTAL);
        assert_eq!(emissions_for_epoch(EMISSION_EPOCHS + 1), 0);
    }

    #[test]
    fn v7_ve_power() {
        let a = 1_000 * ONEUP;
        assert_eq!(ve_power(a, 104), a);
        assert_eq!(ve_power(a, 52), a / 2);
        assert_eq!(ve_power(a, 26), a / 4);
        assert_eq!(ve_power(a, 500), a);
    }

    #[test]
    fn v8_exit_penalty() {
        let a = 1_000 * ONEUP;
        assert_eq!(exit_penalty(a, 104), a / 2);
        assert_eq!(exit_penalty(a, 52), a / 4);
        assert_eq!(exit_penalty(a, 0), 0);
        // rounds up: 1 wei locked with 1 epoch left still pays 1
        assert_eq!(exit_penalty(1, 1), 1);
    }

    #[test]
    fn v9_release() {
        let sched = emissions_for_epoch(1);
        // $1,000 of house profit releases 20,000 $1UP
        assert_eq!(released_emissions(sched, 1_000 * USDC, ONEUP_PER_USDC), 20_000 * ONEUP);
        // capped by what's available
        assert_eq!(released_emissions(sched, 10_000_000 * USDC, ONEUP_PER_USDC), sched);
        assert_eq!(released_emissions(sched, 0, ONEUP_PER_USDC), 0);
    }

    #[test]
    fn backer_cap_follows_the_pool_curve() {
        // a small first backing earns ~2.0×, the whole round from empty averages 1.6×, past $1M it's 1.2×
        assert_eq!(backer_cap_ppm(0, USDC), 1_999_999);
        assert_eq!(backer_cap_ppm(0, LIFE_CAP_POOL), 1_600_000);
        assert_eq!(backer_cap_ppm(LIFE_CAP_POOL, 50_000 * USDC), LIFE_CAP_MIN_PPM);
        // straddling $1M: half at the sloped part's average (1.22×), half at 1.2×
        assert_eq!(backer_cap_ppm(LIFE_CAP_POOL - 50_000 * USDC, 100_000 * USDC), 1_210_000);
        assert_eq!(backer_cap_ppm(500_000 * USDC, 0), life_cap_ppm(500_000 * USDC));
    }

    use proptest::prelude::*;

    proptest! {
        #[test]
        fn backer_cap_is_bounded_and_falls(pool in 0u128..3_000_000 * USDC, amount in 1u128..2_000_000 * USDC, more in 1u128..1_000_000 * USDC) {
            let c = backer_cap_ppm(pool, amount);
            prop_assert!((LIFE_CAP_MIN_PPM..=LIFE_CAP_MAX_PPM).contains(&c));
            // never above the cap at the pool it starts from, never below where it ends
            prop_assert!(c <= life_cap_ppm(pool));
            prop_assert!(c + 1 >= life_cap_ppm(pool + amount));
            // a later backing never earns more
            prop_assert!(backer_cap_ppm(pool + more, amount) <= c);
        }

        #[test]
        fn splitting_a_backing_earns_no_more(pool in 0u128..2_000_000 * USDC, x in 10 * USDC..1_000_000 * USDC, y in 10 * USDC..1_000_000 * USDC) {
            let whole = owed(x + y, backer_cap_ppm(pool, x + y));
            let parts = owed(x, backer_cap_ppm(pool, x)) + owed(y, backer_cap_ppm(pool + x, y));
            // equal up to rounding the cap to a ppm: splitting gains at most 2 ppm of the amount ($2 per $1M)
            prop_assert!(parts <= whole + 2 * (x + y) / PPM + 2, "parts {} whole {}", parts, whole);
        }

        #[test]
        fn pnl_rounds_against_the_trader(margin in 1u128..1_000_000 * USDC, k in 1u32..=250, entry in 1_000u128..10_000_000 * 100_000_000, price in 1_000u128..10_000_000 * 100_000_000, long: bool) {
            let side = if long { Side::Long } else { Side::Short };
            let p = pnl(side, margin, k, entry, price);
            let n = (margin * k as u128) as i128;
            let diff = if long { price as i128 - entry as i128 } else { entry as i128 - price as i128 };
            // p ≤ n·diff/entry exactly: profit rounds down, loss rounds up
            prop_assert!(p.checked_mul(entry as i128).map_or(true, |pe| pe <= n * diff || p == -(margin as i128)));
        }

        #[test]
        fn settlement_conserves_usdc(margin in 1u128..1_000_000 * USDC, pnl_frac in -1_000_000i128..=9_000_000, cut in CUT_BASE_PPM..=CUT_MAX_PPM) {
            let p = margin as i128 * pnl_frac / 1_000_000;
            let s = settle(margin, p, cut);
            // margin in + pool paid = trader out + pool taken
            prop_assert_eq!(margin + s.pool_paid, s.to_trader + s.pool_taken);
            prop_assert!(s.pool_paid <= max_liability(margin));
            prop_assert!(s.to_trader <= margin + max_liability(margin));
            if p > 0 {
                prop_assert!(s.cut * PPM >= p as u128 * cut, "the cut rounds up");
            }
        }

        #[test]
        fn pnl_is_bounded(margin in 1u128..1_000_000 * USDC, k in 1u32..=250, entry in 1u128..10_000_000 * 100_000_000, price in 1u128..10_000_000 * 100_000_000, long: bool) {
            let side = if long { Side::Long } else { Side::Short };
            let p = pnl(side, margin, k, entry, price);
            prop_assert!(p >= -(margin as i128));
            prop_assert!(p <= max_liability(margin) as i128);
        }

        #[test]
        fn payout_keeps_reserve(pool in 0u128..10_000_000 * USDC, liab in 0u128..10_000_000 * USDC, owed in 0u128..10_000_000 * USDC, seed in 0u128..2_000_000 * USDC) {
            let p = epoch_payout(pool, liab, owed, seed);
            // the seed is never shared out
            prop_assert!(pool < seed || pool - p.lives_pot - p.buyback_pot >= seed);
            prop_assert!(p.lives_pot <= owed);
            if pool > p.reserve {
                prop_assert!(pool - p.lives_pot - p.buyback_pot >= p.reserve);
            } else {
                prop_assert_eq!(p.lives_pot + p.buyback_pot, 0);
            }
        }
    }
}
