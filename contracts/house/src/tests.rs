use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};
use oneup_math::USDC;

use crate::events::CloseReason;
use crate::{House, OraclePrice, OrderKind, Side};

const MARKET: &str = "NEAR-USD";
const T0: u64 = 1_800_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn usd(x: u128) -> u128 {
    x * USDC
}

/// Price in cents → oracle struct (expo −8).
fn px(cents: i64, t: u64) -> Option<OraclePrice> {
    Some(OraclePrice { price: cents * 1_000_000, conf: 0, expo: -8, publish_time: t as i64 })
}

fn ctx(predecessor: &str, t: u64) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acc(predecessor))
        .block_timestamp(t * 1_000_000_000)
        .attached_deposit(NearToken::from_yoctonear(0))
        .build());
}

fn setup(seed: u128) -> House {
    ctx("owner", T0);
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    let mut h = House::new(acc("owner"), acc("usdc"), acc("oracle"), None);
    h.add_market(MARKET.into(), "feed".into(), 100);
    ctx("usdc", T0);
    let _ = h.ft_on_transfer(acc("owner"), U128(seed), r#"{"seed":{}}"#.into());
    h
}

fn deposit(h: &mut House, who: &str, amount: u128) {
    ctx("usdc", T0);
    let _ = h.ft_on_transfer(acc(who), U128(amount), String::new());
}

/// Places an open at `t` and fills it at `cents` one second later. Returns the position id.
fn open(h: &mut House, who: &str, side: Side, margin: u128, lev: u32, cents: i64, t: u64) -> u64 {
    ctx(who, t);
    let order = h.place_open(MARKET.into(), side, U128(margin), lev);
    ctx("keeper", t + 1);
    h.internal_fill(order, px(cents, t + 1), t + 1).unwrap();
    h.next_id - 1
}

fn close(h: &mut House, who: &str, pos: u64, cents: i64, t: u64) {
    ctx(who, t);
    let order = h.place_close(pos);
    ctx("keeper", t + 1);
    h.internal_fill(order, px(cents, t + 1), t + 1).unwrap();
}

#[test]
fn deposit_and_seed() {
    let mut h = setup(usd(25_000));
    deposit(&mut h, "alice", usd(100));
    assert_eq!(h.get_pool().0, usd(25_000));
    assert_eq!(h.get_balance(acc("alice")).0, usd(100));
}

#[test]
#[should_panic(expected = "Only USDC deposits")]
fn rejects_other_tokens() {
    let mut h = setup(usd(25_000));
    ctx("fake-usdc", T0);
    let _ = h.ft_on_transfer(acc("alice"), U128(1), String::new());
}

#[test]
#[should_panic(expected = "Only the owner seeds the pool")]
fn only_owner_seeds() {
    let mut h = setup(usd(25_000));
    ctx("usdc", T0);
    let _ = h.ft_on_transfer(acc("alice"), U128(1), r#"{"seed":{}}"#.into());
}

#[test]
fn fills_only_at_a_price_published_after_the_order() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "alice", usd(1_000));
    ctx("alice", T0 + 100);
    let order = h.place_open(MARKET.into(), Side::Long, U128(usd(1_000)), 50);
    assert_eq!(h.get_balance(acc("alice")).0, 0);
    assert_eq!(h.get_solvency().liability.0, usd(9_000));

    // same second as the order: already knowable, refused
    assert!(h.internal_fill(order, px(500, T0 + 100), T0 + 101).is_err());
    // past the 30 s window: refused
    assert!(h.internal_fill(order, px(500, T0 + 131), T0 + 131).is_err());
    // stale at `now`
    assert!(h.internal_fill(order, px(500, T0 + 101), T0 + 200).is_err());
    // wide confidence
    let wide = Some(OraclePrice { price: 500_000_000, conf: 6_000_000, expo: -8, publish_time: (T0 + 101) as i64 });
    assert!(h.internal_fill(order, wide, T0 + 101).is_err());

    h.internal_fill(order, px(500, T0 + 101), T0 + 102).unwrap();
    let p = &h.get_positions(acc("alice"))[0];
    assert_eq!(p.entry_price.0, 500_000_000);
    assert_eq!(p.cut_ppm.0, 145_000); // V3: 9K of a 100K pool
    assert!(h.get_orders(acc("alice")).is_empty());
    // a second fill of the same order finds nothing
    assert!(h.internal_fill(order, px(500, T0 + 103), T0 + 103).is_err());
}

#[test]
fn expired_open_refunds_margin_and_liability() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "alice", usd(1_000));
    ctx("alice", T0);
    let order = h.place_open(MARKET.into(), Side::Short, U128(usd(1_000)), 10);
    ctx("anyone", T0 + 31);
    h.expire(order);
    assert_eq!(h.get_balance(acc("alice")).0, usd(1_000));
    assert_eq!(h.get_solvency().liability.0, 0);
}

#[test]
#[should_panic(expected = "Fill window still open")]
fn cannot_expire_early() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "alice", usd(1_000));
    ctx("alice", T0);
    let order = h.place_open(MARKET.into(), Side::Short, U128(usd(1_000)), 10);
    ctx("anyone", T0 + 30);
    h.expire(order);
}

#[test]
#[should_panic(expected = "Pool can't cover this trade")]
fn v4_solvency_counts_both_sides() {
    let mut h = setup(usd(25_000));
    deposit(&mut h, "alice", usd(3_000));
    open(&mut h, "alice", Side::Long, usd(2_000), 10, 500, T0);
    open(&mut h, "alice", Side::Short, usd(500), 10, 500, T0);
    ctx("alice", T0 + 10);
    h.place_open(MARKET.into(), Side::Long, U128(usd(300)), 10);
}

#[test]
fn quote_explains_a_refusal() {
    let mut h = setup(usd(25_000));
    deposit(&mut h, "alice", usd(3_000));
    open(&mut h, "alice", Side::Long, usd(2_000), 10, 500, T0);
    let q = h.quote_open(MARKET.into(), Side::Short, U128(usd(800)), 10, Some(U128(500_000_000)));
    assert!(!q.allowed);
    assert_eq!(q.reason.as_deref(), Some("Pool can't cover this trade"));
    let q = h.quote_open(MARKET.into(), Side::Short, U128(usd(700)), 10, Some(U128(500_000_000)));
    assert!(q.allowed);
    assert_eq!(q.liquidation_price.unwrap().0, 545_000_000);
}

#[test]
#[should_panic(expected = "Market capacity reached")]
fn market_capacity() {
    let mut h = setup(usd(100_000));
    ctx("owner", T0);
    h.set_capacity(MARKET.into(), U128(100_000)); // 10% → 10K of liability
    deposit(&mut h, "alice", usd(2_000));
    open(&mut h, "alice", Side::Long, usd(1_000), 10, 500, T0);
    ctx("alice", T0 + 10);
    h.place_open(MARKET.into(), Side::Long, U128(usd(200)), 10);
}

#[test]
#[should_panic(expected = "Minimum hold not reached")]
fn minimum_hold() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "alice", usd(1_000));
    let pos = open(&mut h, "alice", Side::Long, usd(1_000), 50, 500, T0);
    ctx("alice", T0 + 60); // opened at T0 + 1
    h.place_close(pos);
}

#[test]
fn winner_pays_the_cut() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "alice", usd(1_000));
    let pos = open(&mut h, "alice", Side::Long, usd(1_000), 50, 500, T0);
    close(&mut h, "alice", pos, 540, T0 + 100); // V3: pnl 4_000 at 14.5%
    assert_eq!(h.get_balance(acc("alice")).0, usd(1_000) + usd(4_000) - usd(580));
    assert_eq!(h.get_pool().0, usd(100_000) - usd(3_420));
    let e = h.get_epoch();
    assert_eq!((e.payouts.0, e.cuts.0, e.losses.0), (usd(3_420), usd(580), 0));
    assert_eq!(h.get_solvency().liability.0, 0);
}

#[test]
fn loser_fills_the_pool_and_gets_a_pending_life() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "bob", usd(1_000));
    let pos = open(&mut h, "bob", Side::Short, usd(1_000), 10, 500, T0);
    close(&mut h, "bob", pos, 525, T0 + 100); // −5% × 10x = −500
    assert_eq!(h.get_balance(acc("bob")).0, usd(500));
    assert_eq!(h.get_pool().0, usd(100_500));
    assert_eq!(h.get_pending_life(acc("bob")).0, usd(500));
}

#[test]
fn liquidation_takes_the_full_margin() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "bob", usd(1_000));
    let pos = open(&mut h, "bob", Side::Long, usd(1_000), 50, 500, T0);
    ctx("keeper", T0 + 50);
    assert_eq!(
        h.internal_keeper_close(pos, CloseReason::Liquidation, px(492, T0 + 50), T0 + 50),
        Err("Position is not eligible")
    );
    // a price older than the entry can't be used
    assert!(h.internal_keeper_close(pos, CloseReason::Liquidation, px(400, T0), T0 + 50).is_err());
    h.internal_keeper_close(pos, CloseReason::Liquidation, px(491, T0 + 51), T0 + 51).unwrap();
    assert_eq!(h.get_balance(acc("bob")).0, 0);
    assert_eq!(h.get_pool().0, usd(101_000));
    assert_eq!(h.get_pending_life(acc("bob")).0, usd(1_000));
    assert!(h.get_position(pos).is_none());
}

#[test]
fn take_profit_at_cap() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "alice", usd(1_000));
    let pos = open(&mut h, "alice", Side::Long, usd(1_000), 100, 500, T0);
    assert!(h.internal_keeper_close(pos, CloseReason::TakeProfit, px(544, T0 + 5), T0 + 5).is_err());
    h.internal_keeper_close(pos, CloseReason::TakeProfit, px(545, T0 + 5), T0 + 5).unwrap();
    // 9_000 profit, cut 14.5% → 1_305
    assert_eq!(h.get_balance(acc("alice")).0, usd(1_000) + usd(9_000) - usd(1_305));
}

#[test]
fn liquidation_cancels_a_pending_close() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "bob", usd(1_000));
    let pos = open(&mut h, "bob", Side::Long, usd(1_000), 50, 500, T0);
    ctx("bob", T0 + 100);
    let order = h.place_close(pos);
    h.internal_keeper_close(pos, CloseReason::Liquidation, px(480, T0 + 100), T0 + 100).unwrap();
    assert!(h.get_orders(acc("bob")).is_empty());
    assert!(h.internal_fill(order, px(500, T0 + 101), T0 + 101).is_err());
}

#[test]
fn expired_close_can_be_placed_again() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "alice", usd(1_000));
    let pos = open(&mut h, "alice", Side::Long, usd(1_000), 10, 500, T0);
    ctx("alice", T0 + 100);
    let order = h.place_close(pos);
    ctx("anyone", T0 + 200);
    h.expire(order);
    assert!(h.get_position(pos).unwrap().close_order.is_none());
    close(&mut h, "alice", pos, 500, T0 + 300);
    assert_eq!(h.get_balance(acc("alice")).0, usd(1_000));
}

/// Decision D-1: under the spec's bigger-side rule both sides can win one after the other.
#[test]
#[should_panic(expected = "Pool can't cover this payout")]
fn d1_spec_rule_can_go_bust() {
    let mut h = setup(usd(10_000));
    ctx("owner", T0);
    let mut params = h.get_params();
    params.solvency_both_sides = false;
    h.set_params(params);
    deposit(&mut h, "alice", usd(1_000));
    deposit(&mut h, "bob", usd(1_000));
    let long = open(&mut h, "alice", Side::Long, usd(1_000), 100, 100, T0);
    // price runs to 1.20; the spec rule sees max(9K, 9K) and lets the short in
    open(&mut h, "bob", Side::Short, usd(1_000), 10, 120, T0 + 10);
    h.internal_keeper_close(long, CloseReason::TakeProfit, px(120, T0 + 20), T0 + 20).unwrap();
    // price falls 90%: the short is owed 6_750 after the cut, the pool holds 3_250
    let short = h.next_id - 1;
    h.internal_keeper_close(short, CloseReason::TakeProfit, px(12, T0 + 30), T0 + 30).unwrap();
}

mod invariants {
    use super::*;
    use proptest::prelude::*;

    #[derive(Clone, Debug)]
    enum Op {
        Open { who: usize, long: bool, margin: u128, lev: u32 },
        Move { bps: i64 },
        Close { pick: usize },
        Keeper { pick: usize },
        Expire { pick: usize },
    }

    fn op() -> impl Strategy<Value = Op> {
        prop_oneof![
            (0..4usize, any::<bool>(), 1u128..3_000, 1u32..=100)
                .prop_map(|(who, long, m, lev)| Op::Open { who, long, margin: m * USDC, lev }),
            (-1_500i64..1_500).prop_map(|bps| Op::Move { bps }),
            (0..16usize).prop_map(|pick| Op::Close { pick }),
            (0..16usize).prop_map(|pick| Op::Keeper { pick }),
            (0..16usize).prop_map(|pick| Op::Expire { pick }),
        ]
    }

    const WHO: [&str; 4] = ["alice", "bob", "carol", "dave"];

    fn total_held(h: &House) -> u128 {
        let balances: u128 = WHO.iter().map(|w| h.get_balance(acc(w)).0).sum();
        let orders: u128 = h
            .orders
            .values()
            .map(|o| match o.kind {
                OrderKind::Open { margin, .. } => margin.0,
                OrderKind::Close { .. } => 0,
            })
            .sum();
        let positions: u128 = h.positions.values().map(|p| p.margin.0).sum();
        h.pool + balances + orders + positions
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        /// Any sequence of trades and price moves: no USDC is created or lost, and the pool always covers
        /// every open position's max win (D-1).
        #[test]
        fn conservation_and_solvency(ops in prop::collection::vec(op(), 1..80)) {
            let seed = usd(25_000);
            let mut h = setup(seed);
            let deposits = usd(10_000);
            for w in WHO { deposit(&mut h, w, deposits); }
            let total = seed + deposits * WHO.len() as u128;

            let mut cents: i64 = 500;
            let mut t = T0 + 10;
            for op in ops {
                t += 7;
                match op {
                    Op::Open { who, long, margin, lev } => {
                        let side = if long { Side::Long } else { Side::Short };
                        let refused = h.quote_open(MARKET.into(), side, U128(margin), lev, None).reason.is_some()
                            || h.get_balance(acc(WHO[who])).0 < margin;
                        if !refused {
                            ctx(WHO[who], t);
                            h.place_open(MARKET.into(), side, U128(margin), lev);
                        }
                    }
                    Op::Move { bps } => cents = (cents * (10_000 + bps) / 10_000).max(1),
                    Op::Close { pick } => {
                        let ps: Vec<_> = h.positions.values().cloned().collect();
                        if let Some(p) = ps.get(pick % ps.len().max(1)) {
                            if p.close_order.is_none() && t >= p.opened_at + 60 {
                                ctx(&p.owner.to_string(), t);
                                h.place_close(p.id);
                            }
                        }
                    }
                    Op::Keeper { pick } => {
                        // fill every fillable order, then try one liquidation / take-profit
                        let ids: Vec<u64> = h.orders.keys().copied().collect();
                        for id in ids { let _ = h.internal_fill(id, px(cents, t), t); }
                        let ps: Vec<u64> = h.positions.keys().copied().collect();
                        if let Some(id) = ps.get(pick % ps.len().max(1)) {
                            let _ = h.internal_keeper_close(*id, CloseReason::Liquidation, px(cents, t), t);
                            let _ = h.internal_keeper_close(*id, CloseReason::TakeProfit, px(cents, t), t);
                        }
                    }
                    Op::Expire { pick } => {
                        let os: Vec<_> = h.orders.values().cloned().collect();
                        if let Some(o) = os.get(pick % os.len().max(1)) {
                            if t > o.placed_at + 30 { ctx("anyone", t); h.expire(o.id); }
                        }
                    }
                }
                prop_assert_eq!(total_held(&h), total);
                prop_assert!(h.liability <= h.pool, "liability {} > pool {}", h.liability, h.pool);
                let sum: u128 = h.markets.values().map(|m| h.market_liability(m)).sum();
                prop_assert_eq!(sum, h.liability);
            }
        }
    }
}
