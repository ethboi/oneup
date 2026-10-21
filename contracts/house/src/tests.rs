use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};
use oneup_math::{ONEUP, USDC};

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
    // full capacity per market, so these tests exercise the pool-wide rule; D-14's 50% has its own test
    let params = crate::Params { epoch_length_s: 600, market_capacity_ppm: U128(oneup_math::PPM), ..Default::default() };
    let mut h = House::new(acc("owner"), acc("usdc"), acc("oracle"), Some(params));
    h.add_market(MARKET.into(), "feed".into(), 100);
    h.set_life(acc("life"));
    h.set_token_and_ve(acc("oneup"), acc("ve"));
    h.set_swap(acc("swap"));
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
    let order = h.place_open(MARKET.into(), side, U128(margin), lev, None, None);
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
    let order = h.place_open(MARKET.into(), Side::Long, U128(usd(1_000)), 50, None, None);
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
    let order = h.place_open(MARKET.into(), Side::Short, U128(usd(1_000)), 10, None, None);
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
    let order = h.place_open(MARKET.into(), Side::Short, U128(usd(1_000)), 10, None, None);
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
    h.place_open(MARKET.into(), Side::Long, U128(usd(300)), 10, None, None);
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
    h.place_open(MARKET.into(), Side::Long, U128(usd(200)), 10, None, None);
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

/// Runs `close_epoch` to the end, landing each mint batch as the life contract would.
fn close_epoch_fully(h: &mut House) -> u32 {
    let mut steps = 0;
    loop {
        steps += 1;
        match h.close_epoch(Some(2)).as_str() {
            "closed" => return steps,
            "waiting for mints" => {
                // lives and loser locks both land through a callback that counts one pending batch down
                for _ in 0..h.get_closing().unwrap().pending_mints {
                    let _ = h.on_minted(U128(0), true, Ok(vec![]));
                }
            }
            "expiring" => {
                let owed = h.lives_owed;
                let _ = h.on_expired(Ok(U128(owed)));
            }
            _ => {}
        }
        assert!(steps < 100);
    }
}

#[test]
fn deposit_and_open_in_one_transfer() {
    let mut h = setup(usd(25_000));
    deposit(&mut h, "alice", usd(200));
    // 300 arrives with an open for 500: the 200 already there covers the rest
    ctx("usdc", T0);
    let msg = format!(r#"{{"open":{{"market_id":"{MARKET}","side":"Long","margin":"{}","leverage":10}}}}"#, usd(500));
    let _ = h.ft_on_transfer(acc("alice"), U128(usd(300)), msg);
    assert_eq!(h.get_balance(acc("alice")).0, 0);
    let orders = h.get_orders(acc("alice"));
    assert_eq!(orders.len(), 1);
    assert!(matches!(orders[0].kind, OrderKind::Open { margin, .. } if margin.0 == usd(500)));
}

#[test]
#[should_panic(expected = "Not enough free balance")]
fn deposit_and_open_refuses_as_a_whole() {
    let mut h = setup(usd(25_000));
    // the panic rolls back the credit too, so the token contract refunds the transfer
    ctx("usdc", T0);
    let msg = format!(r#"{{"open":{{"market_id":"{MARKET}","side":"Long","margin":"{}","leverage":10}}}}"#, usd(500));
    let _ = h.ft_on_transfer(acc("alice"), U128(usd(300)), msg);
}

#[test]
#[should_panic(expected = "Epoch not over yet")]
fn epoch_runs_its_length() {
    let mut h = setup(usd(25_000));
    ctx("keeper", T0 + 599);
    h.close_epoch(None);
}

/// Three traders in one epoch, then the close. Numbers worked by hand in the comments.
#[test]
fn epoch_close_mints_and_pays() {
    let mut h = setup(usd(25_000));
    assert_eq!(h.lives_owed, usd(25_000)); // the seed's Extra Life, 1.0×
    for w in ["alice", "bob", "carol"] {
        deposit(&mut h, w, usd(1_000));
    }
    // Alice wins 200 at 10x; cut 25% (9K of a 25K pool is past the cap) → pool pays 150
    let a = open(&mut h, "alice", Side::Long, usd(1_000), 10, 500, T0);
    close(&mut h, "alice", a, 510, T0 + 100);
    // Bob is liquidated: 1_000
    let b = open(&mut h, "bob", Side::Long, usd(1_000), 50, 500, T0 + 200);
    h.internal_keeper_close(b, CloseReason::Liquidation, px(491, T0 + 210), T0 + 210).unwrap();
    // Carol closes a short at −500
    let c = open(&mut h, "carol", Side::Short, usd(1_000), 10, 500, T0 + 300);
    close(&mut h, "carol", c, 525, T0 + 400);
    assert_eq!(h.get_pool().0, usd(26_350));
    // a loss in the next epoch doesn't count toward this one
    ctx("keeper", T0 + 600);
    assert_eq!(h.close_epoch(Some(1)), "begun");
    assert_eq!(h.get_epoch().id, 2);
    assert_eq!(h.get_pending_life(acc("bob")).0, 0);

    let v = h.get_closing().unwrap();
    assert_eq!(v.house_net.0, usd(1_350)); // 1_500 lost − 150 paid
    assert_eq!(v.cap_ppm.0, 1_978_920); // 2.0 − 0.8 × 26_350 / 1M
    // Alice is listed too (a net winner) but gets nothing
    assert_eq!(v.losers_left, 3);

    assert_eq!(h.close_epoch(Some(1)), "minting");
    assert_eq!(h.close_epoch(Some(1)), "minting");
    assert_eq!(h.close_epoch(Some(1)), "minting");
    assert_eq!(h.close_epoch(Some(1)), "waiting for mints");
    // faces 900 (Bob) and 450 (Carol) at 1.97892×
    assert_eq!(h.lives_owed, usd(25_000) + 1_781_028_000 + 890_514_000);
    // two life batches and two lock batches: 20 $1UP per $1 of the 1_350 profit, by loss 1_000 : 500
    assert_eq!(h.get_closing().unwrap().pending_mints, 4);
    let _ = h.on_minted(U128(0), true, Ok(vec![]));
    let _ = h.on_minted(U128(0), true, Ok(vec![]));
    let _ = h.on_locks(1, U128(18_000 * ONEUP), Ok(U128(18_000 * ONEUP)));
    let _ = h.on_locks(1, U128(9_000 * ONEUP), Ok(U128(9_000 * ONEUP)));
    assert_eq!(h.close_epoch(None), "expiring");
    assert_eq!(h.close_epoch(None), "waiting for expiry");
    // the life contract reports what's still owed; the house takes its number
    let owed = h.lives_owed;
    let _ = h.on_expired(Ok(U128(owed)));

    assert_eq!(h.close_epoch(None), "closed");
    let s = h.get_epoch_summary(1).unwrap();
    // surplus 1_350 above the 25K reserve; pay half: 405 to lives, 202.5 to buybacks
    assert_eq!(s.surplus.0, usd(1_350));
    assert_eq!(s.lives_pot.0, usd(405));
    assert_eq!(s.buyback_pot.0, 202_500_000);
    assert_eq!(s.lives_minted, 2);
    assert_eq!(h.get_pool().0, 25_742_500_000);
    assert!(h.get_closing().is_none());
}

#[test]
fn no_lives_when_the_house_loses() {
    let mut h = setup(usd(25_000));
    deposit(&mut h, "alice", usd(1_000));
    deposit(&mut h, "bob", usd(100));
    let a = open(&mut h, "alice", Side::Long, usd(1_000), 10, 500, T0);
    close(&mut h, "alice", a, 520, T0 + 100); // +400, cut 100 → pool pays 300
    let b = open(&mut h, "bob", Side::Short, usd(100), 10, 500, T0 + 200);
    close(&mut h, "bob", b, 510, T0 + 300); // −20
    ctx("keeper", T0 + 600);
    close_epoch_fully(&mut h);
    let s = h.get_epoch_summary(1).unwrap();
    assert_eq!((s.house_net.0, s.lives_minted, s.lives_pot.0), (0, 0, 0));
}

#[test]
fn failed_mint_is_not_owed() {
    let mut h = setup(usd(25_000));
    let before = h.lives_owed;
    let _ = h.on_minted(U128(usd(500)), false, Err(near_sdk::PromiseError::Failed));
    assert_eq!(h.lives_owed, before - usd(500));
}

#[test]
fn losers_get_oneup_by_house_profit() {
    let mut h = setup(usd(25_000));
    for w in ["alice", "bob", "carol"] {
        deposit(&mut h, w, usd(1_000));
    }
    // Alice wins 200, cut 25% → pool pays 150; Bob and Carol lose 500 and 240 → house profit 590
    let a = open(&mut h, "alice", Side::Long, usd(1_000), 10, 500, T0);
    close(&mut h, "alice", a, 510, T0 + 100);
    let b = open(&mut h, "bob", Side::Short, usd(1_000), 10, 500, T0 + 200);
    close(&mut h, "bob", b, 525, T0 + 300);
    let c = open(&mut h, "carol", Side::Short, usd(1_000), 10, 500, T0 + 400);
    close(&mut h, "carol", c, 512 /* −2.4% × 10 = −240 */, T0 + 500);
    ctx("keeper", T0 + 600);
    close_epoch_fully(&mut h);

    let sched = oneup_math::emissions_for_epoch(1);
    let e = h.get_emissions(1).unwrap();
    assert_eq!(e.released.0, 590 * 20 * ONEUP);
    // shared 500 : 240 and floored; the dust goes back to the carry
    let bob = e.released.0 * 500 / 740;
    let carol = e.released.0 * 240 / 740;
    assert_eq!(e.locked.0, bob + carol);
    assert_eq!(h.get_emission_carry().0, sched - bob - carol);
    assert_eq!(e.carry.0, h.get_emission_carry().0);
}

#[test]
fn no_release_when_the_house_loses() {
    let mut h = setup(usd(25_000));
    deposit(&mut h, "alice", usd(1_000));
    let a = open(&mut h, "alice", Side::Long, usd(1_000), 10, 500, T0);
    close(&mut h, "alice", a, 520, T0 + 100);
    ctx("keeper", T0 + 600);
    close_epoch_fully(&mut h);
    // the whole schedule waits for profit
    assert_eq!(h.get_emissions(1).unwrap().released.0, 0);
    assert_eq!(h.get_emission_carry().0, oneup_math::emissions_for_epoch(1));
}

#[test]
fn failed_locks_go_back_to_the_carry() {
    let mut h = setup(usd(25_000));
    deposit(&mut h, "bob", usd(1_000));
    let b = open(&mut h, "bob", Side::Short, usd(1_000), 10, 500, T0);
    close(&mut h, "bob", b, 525, T0 + 100); // −500
    ctx("keeper", T0 + 600);
    assert_eq!(h.close_epoch(None), "begun");
    assert_eq!(h.close_epoch(None), "minting");
    let carry = h.get_emission_carry().0;
    let _ = h.on_locks(1, U128(10_000 * ONEUP), Ok(U128(0)));
    assert_eq!(h.get_emission_carry().0, carry + 10_000 * ONEUP);
    assert_eq!(h.get_emissions(1).unwrap().locked.0, 0);
}

#[test]
fn new_markets_get_half_the_pool() {
    ctx("owner", T0);
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    let mut h = House::new(acc("owner"), acc("usdc"), acc("oracle"), None);
    h.add_market(MARKET.into(), "feed".into(), 100);
    h.set_life(acc("life"));
    ctx("usdc", T0);
    let _ = h.ft_on_transfer(acc("owner"), U128(usd(100_000)), r#"{"seed":{}}"#.into());
    assert_eq!(h.get_markets()[0].capacity_ppm.0, 500_000);
    // 6_000 margin → 54K of max wins, past half of the 100K pool
    let q = h.quote_open(MARKET.into(), Side::Long, U128(usd(6_000)), 2, Some(U128(500_000_000)));
    assert_eq!(q.reason.as_deref(), Some("Market capacity reached"));
    let q = h.quote_open(MARKET.into(), Side::Long, U128(usd(5_000)), 2, Some(U128(500_000_000)));
    assert!(q.allowed);
}

#[test]
#[should_panic(expected = "Only the owner")]
fn only_the_owner_lists_markets() {
    let mut h = setup(usd(25_000));
    ctx("ve", T0);
    h.add_market("MEME-USD".into(), "meme".into(), 100);
}

#[test]
fn buyback_goes_to_lockers() {
    let mut h = setup(usd(25_000));
    deposit(&mut h, "bob", usd(1_000));
    let b = open(&mut h, "bob", Side::Short, usd(1_000), 10, 500, T0);
    close(&mut h, "bob", b, 537, T0 + 100);
    ctx("keeper", T0 + 600);
    close_epoch_fully(&mut h);

    let bb = h.get_buyback(1).unwrap();
    assert_eq!(bb.status, crate::BuybackStatus::Pending);
    assert_eq!(bb.usdc.0, h.get_epoch_summary(1).unwrap().buyback_pot.0);

    ctx("owner", T0 + 700);
    h.buyback(1, U128(0));
    assert_eq!(h.get_buyback(1).unwrap().status, crate::BuybackStatus::Swapping);
    // the swap pulled the USDC
    let held = h.buyback_usdc;
    let _ = h.on_buyback_sent(1, bb.usdc, Ok(bb.usdc));
    assert_eq!(h.buyback_usdc, held - bb.usdc.0);
    // proceeds arrive and are forwarded to ve
    ctx("oneup", T0 + 701);
    let _ = h.ft_on_transfer(acc("swap"), U128(1_000_000), r#"{"buyback_proceeds":{"epoch":1}}"#.into());
    let bb = h.get_buyback(1).unwrap();
    assert_eq!((bb.status, bb.oneup.0), (crate::BuybackStatus::Done, 1_000_000));
}

#[test]
fn refused_swap_can_be_retried() {
    let mut h = setup(usd(25_000));
    deposit(&mut h, "bob", usd(1_000));
    let b = open(&mut h, "bob", Side::Short, usd(1_000), 10, 500, T0);
    close(&mut h, "bob", b, 550, T0 + 100);
    ctx("keeper", T0 + 600);
    close_epoch_fully(&mut h);
    ctx("owner", T0 + 700);
    h.buyback(1, U128(u128::MAX));
    let usdc = h.get_buyback(1).unwrap().usdc;
    let _ = h.on_buyback_sent(1, usdc, Ok(U128(0)));
    assert_eq!(h.get_buyback(1).unwrap().status, crate::BuybackStatus::Pending);
}

#[test]
#[should_panic(expected = "Only swap proceeds")]
fn proceeds_only_from_the_swap() {
    let mut h = setup(usd(25_000));
    ctx("oneup", T0);
    let _ = h.ft_on_transfer(acc("mallory"), U128(1), r#"{"buyback_proceeds":{"epoch":1}}"#.into());
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
        CloseEpoch,
        /// D-19: set a trigger anywhere (even across the price) and have the keeper try it
        Trigger { pick: usize, stop: bool, cents: i64 },
        /// D-22: back the pool from a wallet's free balance
        Back { who: usize, amount: u128 },
    }

    fn op() -> impl Strategy<Value = Op> {
        prop_oneof![
            (0..4usize, any::<bool>(), 1u128..3_000, 1u32..=100)
                .prop_map(|(who, long, m, lev)| Op::Open { who, long, margin: m * USDC, lev }),
            (-1_500i64..1_500).prop_map(|bps| Op::Move { bps }),
            (0..16usize).prop_map(|pick| Op::Close { pick }),
            (0..16usize).prop_map(|pick| Op::Keeper { pick }),
            (0..16usize).prop_map(|pick| Op::Expire { pick }),
            Just(Op::CloseEpoch),
            (0..16usize, any::<bool>(), 1i64..2_000).prop_map(|(pick, stop, cents)| Op::Trigger { pick, stop, cents }),
            (0..4usize, 10u128..2_000).prop_map(|(who, a)| Op::Back { who, amount: a * USDC }),
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
        h.pool + balances + orders + positions + h.buyback_usdc + h.lives_paid
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
            let mut total = seed + deposits * WHO.len() as u128;

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
                            h.place_open(MARKET.into(), side, U128(margin), lev, None, None);
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
                    Op::CloseEpoch => {
                        t += 600;
                        ctx("keeper", t);
                        close_epoch_fully(&mut h);
                    }
                    Op::Expire { pick } => {
                        let os: Vec<_> = h.orders.values().cloned().collect();
                        if let Some(o) = os.get(pick % os.len().max(1)) {
                            if t > o.placed_at + 30 { ctx("anyone", t); h.expire(o.id); }
                        }
                    }
                    Op::Trigger { pick, stop, cents: at } => {
                        let ps: Vec<_> = h.positions.values().cloned().collect();
                        if let Some(p) = ps.get(pick % ps.len().max(1)) {
                            ctx(&p.owner.to_string(), t);
                            let at = Some(U128(at as u128 * 1_000_000));
                            if stop { h.set_triggers(p.id, None, at) } else { h.set_triggers(p.id, at, None) }
                            let reason = if stop { CloseReason::Stop } else { CloseReason::Target };
                            // the price the trader saw when setting it never closes the position
                            let _ = h.internal_keeper_close(p.id, reason, px(cents, t), t);
                            prop_assert!(h.positions.get(&p.id).is_some_and(|q| q.close_order == p.close_order));
                            let _ = h.internal_keeper_close(p.id, reason, px(cents, t + 1), t + 1);
                            // a hit only places a close; the position is still open
                            prop_assert!(h.positions.contains_key(&p.id));
                        }
                    }
                    Op::Back { who, amount } => {
                        // backing is new money from outside: the wallet's deposit, straight to the pool
                        ctx("usdc", t);
                        let _ = h.ft_on_transfer(acc(WHO[who]), U128(amount), r#"{"back":{}}"#.into());
                        total += amount;
                    }
                }
                let net: u128 = h.epoch_losses.values().map(|v| (*v).max(0) as u128).sum();
                prop_assert_eq!(net, h.epoch.net_losses.0);
                prop_assert_eq!(total_held(&h), total);
                prop_assert!(h.liability <= h.pool, "liability {} > pool {}", h.liability, h.pool);
                prop_assert!(h.pool >= oneup_math::reserve(h.liability, h.reserve_floor()).min(h.pool));
                let sum: u128 = h.markets.values().map(|m| h.market_liability(m)).sum();
                prop_assert_eq!(sum, h.liability);
            }
        }
    }
}

/// Decision D-19: take-profit and stop-loss, set with the order or later.
fn open_with(h: &mut House, who: &str, side: Side, lev: u32, cents: i64, tp: Option<i64>, sl: Option<i64>) -> u64 {
    let c = |x: i64| U128(x as u128 * 1_000_000);
    ctx(who, T0);
    let order = h.place_open(MARKET.into(), side, U128(usd(1_000)), lev, tp.map(c), sl.map(c));
    ctx("keeper", T0 + 1);
    h.internal_fill(order, px(cents, T0 + 1), T0 + 1).unwrap();
    h.next_id - 1
}

#[test]
fn take_profit_from_the_order_waits_out_the_hold() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "alice", usd(1_000));
    let pos = open_with(&mut h, "alice", Side::Long, 10, 500, Some(510), Some(490));
    // reached, but inside the 60 s minimum hold
    assert!(h.internal_keeper_close(pos, CloseReason::Target, px(511, T0 + 30), T0 + 30).is_err());
    // not reached
    assert!(h.internal_keeper_close(pos, CloseReason::Target, px(509, T0 + 70), T0 + 70).is_err());
    // the stop isn't hit by a rising price
    assert!(h.internal_keeper_close(pos, CloseReason::Stop, px(511, T0 + 70), T0 + 70).is_err());
    // reached: places a close, which fills at the next price, not at the trigger or the price that crossed
    h.internal_keeper_close(pos, CloseReason::Target, px(512, T0 + 71), T0 + 71).unwrap();
    let order = h.get_position(pos).unwrap().close_order.unwrap();
    h.internal_fill(order, px(512, T0 + 72), T0 + 72).unwrap();
    assert!(h.get_position(pos).is_none());
    // +2.4% on 10,000 = +240, less the winner's cut
    let bal = h.get_balance(acc("alice")).0;
    assert!(bal > usd(1_000) && bal < usd(1_240));
}

#[test]
fn stop_loss_on_a_short_counts_as_a_loss() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "bob", usd(1_000));
    let pos = open_with(&mut h, "bob", Side::Short, 10, 500, None, Some(505));
    assert!(h.internal_keeper_close(pos, CloseReason::Stop, px(504, T0 + 70), T0 + 70).is_err());
    h.internal_keeper_close(pos, CloseReason::Stop, px(506, T0 + 71), T0 + 71).unwrap();
    let order = h.get_position(pos).unwrap().close_order.unwrap();
    h.internal_fill(order, px(506, T0 + 72), T0 + 72).unwrap();
    // −1.2% on 10,000 = −120: the rest comes back and the loss counts toward an Extra Life
    assert_eq!(h.get_balance(acc("bob")).0, usd(880));
    assert_eq!(h.get_pending_life(acc("bob")).0, usd(120));
}

#[test]
fn triggers_set_later_fire_only_on_a_newer_price() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "alice", usd(1_000));
    let pos = open_with(&mut h, "alice", Side::Long, 10, 500, None, None);
    assert!(h.internal_keeper_close(pos, CloseReason::Target, px(520, T0 + 90), T0 + 90).is_err());
    // a target already below the price: it must not close at the price she could see when setting it
    ctx("alice", T0 + 100);
    h.set_triggers(pos, Some(U128(490 * 1_000_000)), None);
    assert!(h.internal_keeper_close(pos, CloseReason::Target, px(520, T0 + 100), T0 + 100).is_err());
    h.internal_keeper_close(pos, CloseReason::Target, px(519, T0 + 101), T0 + 101).unwrap();
    let order = h.get_position(pos).unwrap().close_order.unwrap();
    h.internal_fill(order, px(519, T0 + 102), T0 + 102).unwrap();
    assert!(h.get_position(pos).is_none());
}

#[test]
fn triggers_can_be_cleared() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "bob", usd(1_000));
    let pos = open_with(&mut h, "bob", Side::Long, 10, 500, Some(510), Some(490));
    ctx("bob", T0 + 10);
    h.set_triggers(pos, None, None);
    assert!(h.internal_keeper_close(pos, CloseReason::Stop, px(480, T0 + 80), T0 + 80).is_err());
    assert!(h.internal_keeper_close(pos, CloseReason::Target, px(520, T0 + 80), T0 + 80).is_err());
}

#[test]
#[should_panic(expected = "Not your position")]
fn only_the_owner_sets_triggers() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "bob", usd(1_000));
    let pos = open_with(&mut h, "bob", Side::Long, 10, 500, None, None);
    ctx("mallory", T0 + 10);
    h.set_triggers(pos, None, Some(U128(499 * 1_000_000)));
}

/// Decision D-20: the house can be handed to a DAO; an operator keeps running buybacks.
#[test]
fn owner_hands_over_and_operator_stays() {
    let mut h = setup(usd(100_000));
    ctx("owner", T0);
    h.set_operator(Some(acc("keeper")));
    h.set_owner(acc("dao"));
    assert_eq!(h.get_owner(), (acc("dao"), Some(acc("keeper"))));
    ctx("dao", T0);
    h.add_market("SOL-USD".into(), "sol".into(), 50);
    assert!(h.get_markets().iter().any(|m| m.id == "SOL-USD"));
}

#[test]
#[should_panic(expected = "Only the owner")]
fn old_owner_loses_control() {
    let mut h = setup(usd(100_000));
    ctx("owner", T0);
    h.set_owner(acc("dao"));
    h.add_market("SOL-USD".into(), "sol".into(), 50);
}

#[test]
#[should_panic(expected = "Only the owner or operator")]
fn strangers_cannot_buy_back() {
    let mut h = setup(usd(100_000));
    ctx("mallory", T0);
    h.buyback(1, U128(0));
}

/// Decision D-21: deposits delivered by the NEAR Intents Verifier credit the account they name, and an
/// order they carry is never refused (the Verifier wouldn't return the tokens): it just isn't placed.
fn intents_deposit(h: &mut House, amount: u128, msg: &str) {
    ctx("usdc", T0);
    let _ = h.ft_on_transfer(acc("intents"), U128(amount), msg.into());
}

#[test]
fn intents_deposit_credits_the_named_account() {
    let mut h = setup(usd(100_000));
    ctx("owner", T0);
    h.set_intents(Some(acc("intents")));
    intents_deposit(&mut h, usd(500), r#"{"for":{"account_id":"alice"}}"#);
    assert_eq!(h.get_balance(acc("alice")).0, usd(500));
    assert_eq!(h.get_balance(acc("intents")).0, 0);
}

#[test]
fn intents_deposit_and_open() {
    let mut h = setup(usd(100_000));
    ctx("owner", T0);
    h.set_intents(Some(acc("intents")));
    intents_deposit(&mut h, usd(500), r#"{"open":{"market_id":"NEAR-USD","side":"Long","margin":"500000000","leverage":10,"account_id":"alice"}}"#);
    let orders = h.get_orders(acc("alice"));
    assert_eq!(orders.len(), 1);
    assert_eq!(h.get_balance(acc("alice")).0, 0);
}

#[test]
fn intents_refused_open_keeps_the_deposit() {
    let mut h = setup(usd(100_000));
    ctx("owner", T0);
    h.set_intents(Some(acc("intents")));
    // 500× is over the market's 100× limit: no order, but the USDC is alice's, not lost
    intents_deposit(&mut h, usd(500), r#"{"open":{"market_id":"NEAR-USD","side":"Long","margin":"500000000","leverage":500,"account_id":"alice"}}"#);
    assert!(h.get_orders(acc("alice")).is_empty());
    assert_eq!(h.get_balance(acc("alice")).0, usd(500));
}

#[test]
#[should_panic(expected = "Only NEAR Intents deposits name an account")]
fn others_cannot_deposit_for_someone_else() {
    let mut h = setup(usd(100_000));
    ctx("owner", T0);
    h.set_intents(Some(acc("intents")));
    ctx("usdc", T0);
    let _ = h.ft_on_transfer(acc("mallory"), U128(usd(5)), r#"{"for":{"account_id":"alice"}}"#.into());
}

// Security review fixes (21 Oct 2026)

/// A trigger can be set at any price, so a hit must never settle at a price already on chain: it places a
/// close that only a newer price fills. Otherwise a stop at u128::MAX is a close-whenever-the-oracle-lags
/// button.
#[test]
fn trigger_at_any_price_cannot_close_at_a_known_price() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "alice", usd(1_000));
    let pos = open_with(&mut h, "alice", Side::Long, 10, 500, None, None);
    ctx("alice", T0 + 70);
    h.set_triggers(pos, None, Some(U128(u128::MAX)));
    h.internal_keeper_close(pos, CloseReason::Stop, px(520, T0 + 71), T0 + 71).unwrap();
    let order = h.get_position(pos).unwrap().close_order.unwrap();
    // the 5.20 she saw can't fill it, only a later price
    assert_eq!(h.internal_fill(order, px(520, T0 + 71), T0 + 71), Err("Price is not newer than the order"));
    h.internal_fill(order, px(505, T0 + 72), T0 + 72).unwrap();
    // +1% on 10,000 = +100, less the cut: settled at 5.05, not 5.20
    assert!(h.get_balance(acc("alice")).0 < usd(1_100));
    // a second hit while the close is pending does nothing
    let pos2 = open_with(&mut h, "alice", Side::Long, 10, 500, None, Some(1_000));
    h.internal_keeper_close(pos2, CloseReason::Stop, px(500, T0 + 80), T0 + 80).unwrap();
    assert_eq!(h.internal_keeper_close(pos2, CloseReason::Stop, px(500, T0 + 81), T0 + 81), Err("Close already pending"));
}

#[test]
fn a_trigger_close_reports_its_reason() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "bob", usd(1_000));
    let pos = open_with(&mut h, "bob", Side::Long, 10, 500, Some(510), None);
    h.internal_keeper_close(pos, CloseReason::Target, px(511, T0 + 70), T0 + 70).unwrap();
    let order = h.get_position(pos).unwrap().close_order.unwrap();
    assert!(matches!(h.orders.get(&order).unwrap().kind, OrderKind::Close { reason: CloseReason::Target, .. }));
}

#[test]
#[should_panic(expected = "Only the keeper")]
fn only_the_keeper_fills_once_set() {
    let mut h = setup(usd(100_000));
    ctx("owner", T0);
    h.set_keeper(Some(acc("keeper")));
    deposit(&mut h, "alice", usd(1_000));
    ctx("alice", T0);
    let order = h.place_open(MARKET.into(), Side::Long, U128(usd(100)), 10, None, None);
    // a trader filling their own order could pick the price inside the window
    let _ = h.fill(order);
}

#[test]
#[should_panic(expected = "Only the keeper")]
fn only_the_keeper_takes_profit_at_the_cap() {
    let mut h = setup(usd(100_000));
    ctx("owner", T0);
    h.set_keeper(Some(acc("keeper")));
    deposit(&mut h, "alice", usd(1_000));
    let pos = open(&mut h, "alice", Side::Long, usd(100), 100, 500, T0);
    ctx("alice", T0 + 100);
    let _ = h.take_profit(pos);
}

#[test]
fn the_keeper_and_operator_may_fill() {
    let mut h = setup(usd(100_000));
    ctx("owner", T0);
    h.set_keeper(Some(acc("keeper")));
    h.set_operator(Some(acc("op")));
    deposit(&mut h, "alice", usd(1_000));
    ctx("alice", T0);
    let order = h.place_open(MARKET.into(), Side::Long, U128(usd(100)), 10, None, None);
    for who in ["keeper", "op", "owner"] {
        ctx(who, T0 + 1);
        let _ = h.fill(order);
    }
    assert_eq!(h.get_keeper(), Some(acc("keeper")));
}

/// Whoever withdraws from the Verifier writes the message, so it names any account: an Intents open
/// may only trade the USDC it brought, never the named account's existing balance.
#[test]
fn intents_open_trades_only_the_deposit() {
    let mut h = setup(usd(100_000));
    ctx("owner", T0);
    h.set_intents(Some(acc("intents")));
    deposit(&mut h, "victim", usd(1_000));
    intents_deposit(&mut h, 1, r#"{"open":{"market_id":"NEAR-USD","side":"Long","margin":"1000000000","leverage":100,"account_id":"victim"}}"#);
    assert!(h.get_orders(acc("victim")).is_empty());
    assert_eq!(h.get_balance(acc("victim")).0, usd(1_000) + 1);
}

/// D-16 by net loss: a long and a short on yourself only lose the winner's cut, so that's all that counts.
#[test]
fn wash_trading_counts_only_the_net_loss() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "mallory", usd(2_000));
    deposit(&mut h, "bob", usd(1_000));
    let l = open(&mut h, "mallory", Side::Long, usd(1_000), 10, 500, T0);
    let s = open(&mut h, "mallory", Side::Short, usd(1_000), 10, 500, T0);
    close(&mut h, "mallory", l, 510, T0 + 100); // +200 less the cut
    close(&mut h, "mallory", s, 510, T0 + 100); // −200
    let cut = h.get_epoch().cuts.0;
    assert!(cut > 0);
    assert_eq!(h.get_pending_life(acc("mallory")).0, cut);
    // an honest loser's share isn't diluted by the gross 200
    let b = open(&mut h, "bob", Side::Long, usd(1_000), 10, 500, T0 + 200);
    close(&mut h, "bob", b, 490, T0 + 300); // −200
    assert_eq!(h.get_epoch().net_losses.0, cut + usd(200));
    // a net winner has no pending life
    deposit(&mut h, "alice", usd(1_000));
    let a = open(&mut h, "alice", Side::Long, usd(1_000), 10, 500, T0 + 400);
    close(&mut h, "alice", a, 510, T0 + 500);
    assert_eq!(h.get_pending_life(acc("alice")).0, 0);
}

#[test]
#[should_panic(expected = "Deposit below the minimum")]
fn dust_cannot_open_a_balance() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "fake-1", 1);
}

#[test]
fn an_existing_balance_takes_any_amount() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "alice", usd(1));
    deposit(&mut h, "alice", 1);
    assert_eq!(h.get_balance(acc("alice")).0, usd(1) + 1);
}

#[test]
#[should_panic(expected = "Deposit below the minimum")]
fn intents_dust_cannot_open_a_balance() {
    let mut h = setup(usd(100_000));
    ctx("owner", T0);
    h.set_intents(Some(acc("intents")));
    intents_deposit(&mut h, 5, r#"{"for":{"account_id":"fake-2"}}"#);
}

#[test]
#[should_panic(expected = "no open positions or orders")]
fn solvency_rule_cannot_change_with_pending_orders() {
    let mut h = setup(usd(100_000));
    deposit(&mut h, "alice", usd(1_000));
    ctx("alice", T0);
    h.place_open(MARKET.into(), Side::Long, U128(usd(100)), 10, None, None);
    ctx("owner", T0);
    let p = crate::Params { solvency_both_sides: false, ..h.get_params() };
    h.set_params(p);
}

#[test]
fn a_partial_buyback_is_not_swapped_twice() {
    let mut h = setup(usd(100_000));
    let e = h.get_epoch();
    h.record_buyback(&e, usd(100));
    h.buyback_usdc = usd(100);
    h.buybacks.get_mut(&e.id).unwrap().status = crate::BuybackStatus::Swapping;
    let pool = h.pool;
    let _ = h.on_buyback_sent(e.id, U128(usd(100)), Ok(U128(usd(60))));
    let b = h.get_buyback(e.id).unwrap();
    assert_eq!((b.usdc.0, b.status), (usd(60), crate::BuybackStatus::Done));
    assert_eq!(h.buyback_usdc, 0);
    assert_eq!(h.pool, pool + usd(40));
}

#[test]
fn a_refused_pot_is_still_owed() {
    let mut h = setup(usd(25_000));
    h.lives_owed = usd(1_000);
    h.lives_paid = usd(400);
    h.pool -= usd(400);
    let pool = h.pool;
    let _ = h.on_pot(U128(usd(400)), Ok(U128(0)));
    assert_eq!((h.lives_owed, h.lives_paid, h.pool), (usd(1_400), 0, pool + usd(400)));
}

/// Decision D-22: anyone backs the pool and gets a Backer Life; early dollars earn more.
#[test]
fn anyone_can_back_the_pool() {
    let mut h = setup(usd(25_000));
    let owed_before = h.lives_owed;
    ctx("usdc", T0);
    let _ = h.ft_on_transfer(acc("bob"), U128(usd(10_000)), r#"{"back":{}}"#.into());
    let cap = oneup_math::backer_cap_ppm(usd(25_000), usd(10_000));
    assert_eq!(cap, 1_976_000); // the average of 1.98× at 25K and 1.972× at 35K
    assert_eq!(h.get_pool().0, usd(35_000));
    assert_eq!(h.reserve_floor(), usd(35_000)); // only ever paid back from profit
    assert_eq!(h.lives_owed, owed_before + usd(19_760));
    // a later backer gets less
    let b = h.get_backing(Some(U128(usd(10_000))));
    assert!(b.cap_ppm.0 < cap && b.open);
    assert_eq!(b.backed.0, usd(35_000));
}

#[test]
#[should_panic(expected = "Backing round is full")]
fn backing_stops_at_the_target() {
    let mut h = setup(usd(25_000));
    ctx("owner", T0);
    h.set_params(crate::Params { backing_target: U128(usd(30_000)), ..h.get_params() });
    ctx("usdc", T0);
    let _ = h.ft_on_transfer(acc("bob"), U128(usd(5_001)), r#"{"back":{}}"#.into());
}

#[test]
#[should_panic(expected = "Back with at least 10 USDC")]
fn backing_has_a_minimum() {
    let mut h = setup(usd(25_000));
    ctx("usdc", T0);
    let _ = h.ft_on_transfer(acc("bob"), U128(usd(9)), r#"{"back":{}}"#.into());
}

#[test]
fn a_failed_backer_mint_returns_the_backing() {
    let mut h = setup(usd(25_000));
    ctx("usdc", T0);
    let _ = h.ft_on_transfer(acc("bob"), U128(usd(1_000)), r#"{"back":{}}"#.into());
    let owed = h.lives_owed;
    let _ = h.on_backer_minted(acc("bob"), U128(usd(1_000)), U128(usd(1_970)), Err(near_sdk::PromiseError::Failed));
    assert_eq!((h.pool, h.seed), (usd(25_000), usd(25_000)));
    assert_eq!(h.lives_owed, owed - usd(1_970));
    assert_eq!(h.get_balance(acc("bob")).0, usd(1_000));
}

#[test]
fn the_owner_can_seed_twice() {
    let mut h = setup(usd(25_000));
    ctx("usdc", T0);
    let _ = h.ft_on_transfer(acc("owner"), U128(usd(5_000)), r#"{"seed":{}}"#.into());
    // both seeds are owed back at 1.0×
    assert_eq!((h.seed, h.lives_owed), (usd(30_000), usd(30_000)));
}
