use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, PromiseOrValue};
use oneup_math::{ONEUP, PPM};

use crate::Ve;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str) {
    testing_env!(VMContextBuilder::new().predecessor_account_id(acc(predecessor)).build());
}

fn setup() -> Ve {
    ctx("owner");
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    Ve::new(acc("owner"), acc("house"), acc("oneup"), acc("usdc"), acc("treasury"))
}

fn send(v: &mut Ve, token: &str, sender: &str, amount: u128, msg: &str) -> u128 {
    ctx(token);
    match v.ft_on_transfer(acc(sender), U128(amount), msg.into()) {
        PromiseOrValue::Value(x) => x.0,
        _ => unreachable!(),
    }
}

fn lock(v: &mut Ve, who: &str, amount: u128, epochs: u64) -> String {
    send(v, "oneup", who, amount * ONEUP, &format!(r#"{{"lock":{{"epochs":{epochs}}}}}"#));
    (v.next_lock - 1).to_string()
}

fn vote(v: &mut Ve, who: &str, id: &str, alloc: &[(&str, u128)]) {
    ctx(who);
    v.vote(id.into(), alloc.iter().map(|(m, a)| (m.to_string(), U128(*a))).collect());
}

fn checkpoint(v: &mut Ve, e: u64) {
    ctx("house");
    v.checkpoint(e);
}

#[test]
fn lock_vote_checkpoint() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 52);
    let b = lock(&mut v, "bob", 1_300, 13);
    vote(&mut v, "alice", &a, &[("NEAR", PPM)]);
    vote(&mut v, "bob", &b, &[("NEAR", 600_000), ("BTC", 400_000)]);
    assert_eq!(v.lock_info(a.clone()).unwrap().power.0, 1_000 * ONEUP);
    checkpoint(&mut v, 2);
    // Alice 1_000 on NEAR; Bob 325 split 195 NEAR / 130 BTC
    assert_eq!(v.get_votes(2), vec![("BTC".into(), U128(130 * ONEUP)), ("NEAR".into(), U128(1_195 * ONEUP))]);
    // one epoch later both locks have decayed by 1/52 of their amount
    checkpoint(&mut v, 3);
    let near = 1_000 * ONEUP * 51 / 52 + 1_300 * ONEUP * 600_000 * 12 / (52 * PPM);
    assert_eq!(v.get_votes(3).iter().find(|(m, _)| m == "NEAR").unwrap().1 .0, near);
}

#[test]
fn bribes_pay_next_epochs_voters() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 3_000, 52);
    let b = lock(&mut v, "bob", 1_000, 52);
    vote(&mut v, "alice", &a, &[("MEME", PPM)]);
    vote(&mut v, "bob", &b, &[("MEME", PPM)]);
    // a project bribes 400 of its token during epoch 1 → for epoch 2's voters
    assert_eq!(send(&mut v, "meme.token", "project", 400, r#"{"bribe":{"market_id":"MEME"}}"#), 0);
    checkpoint(&mut v, 2);
    checkpoint(&mut v, 3);
    assert_eq!(v.get_claimable(a.clone(), vec![2]), vec![(acc("meme.token"), U128(300))]);
    assert_eq!(v.get_claimable(b.clone(), vec![2]), vec![(acc("meme.token"), U128(100))]);
    ctx("alice");
    v.claim(a.clone(), vec![2]);
    assert!(v.get_claimable(a, vec![2]).is_empty());
}

#[test]
fn buyback_rewards_by_market_and_late_arrivals() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 52);
    let b = lock(&mut v, "bob", 1_000, 52);
    vote(&mut v, "alice", &a, &[("NEAR", PPM)]);
    vote(&mut v, "bob", &b, &[("BTC", PPM)]);
    checkpoint(&mut v, 2);
    checkpoint(&mut v, 3);
    // the house's epoch-2 buyback: NEAR made all the profit
    let msg = r#"{"buyback":{"epoch":2,"per_market":[["NEAR","900"],["BTC","100"]]}}"#;
    send(&mut v, "oneup", "house", 1_000, msg);
    assert_eq!(v.get_claimable(a.clone(), vec![2]), vec![(acc("oneup"), U128(900))]);
    ctx("alice");
    v.claim(a.clone(), vec![2]);
    // a second buyback for the same epoch can still be claimed
    send(&mut v, "oneup", "house", 90, r#"{"buyback":{"epoch":2,"per_market":[["NEAR","90"]]}}"#);
    assert_eq!(v.get_claimable(a, vec![2]), vec![(acc("oneup"), U128(90))]);
    assert_eq!(v.get_claimable(b, vec![2]), vec![(acc("oneup"), U128(100))]);
}

#[test]
fn changing_a_vote_moves_it_next_epoch() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 5_200, 52);
    vote(&mut v, "alice", &a, &[("NEAR", PPM)]);
    checkpoint(&mut v, 2);
    vote(&mut v, "alice", &a, &[("BTC", PPM)]);
    assert_eq!(v.get_votes(2), vec![("NEAR".into(), U128(5_200 * ONEUP))]);
    checkpoint(&mut v, 3);
    assert_eq!(v.get_votes(3), vec![("BTC".into(), U128(5_100 * ONEUP))]);
}

#[test]
fn unlock_after_end() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 100, 1); // counts for epoch 2 only, ends at 3
    vote(&mut v, "alice", &a, &[("NEAR", PPM)]);
    checkpoint(&mut v, 2);
    assert_eq!(v.get_votes(2), vec![("NEAR".into(), U128(100 * ONEUP / 52))]);
    checkpoint(&mut v, 3);
    assert!(v.get_votes(3).is_empty());
    ctx("alice");
    v.unlock(a.clone());
    assert!(v.lock_info(a).unwrap().withdrawn);
}

#[test]
#[should_panic(expected = "Lock still running")]
fn no_early_unlock() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 100, 2);
    ctx("alice");
    v.unlock(a);
}

#[test]
#[should_panic(expected = "Allocations must sum to 1000000")]
fn votes_sum_to_100_percent() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 100, 2);
    vote(&mut v, "alice", &a, &[("NEAR", 500_000)]);
}

#[test]
#[should_panic(expected = "Only $1UP can be locked")]
fn only_oneup_locks() {
    let mut v = setup();
    send(&mut v, "usdc", "alice", 100, r#"{"lock":{"epochs":4}}"#);
}

#[test]
#[should_panic(expected = "Only house buybacks")]
fn only_house_buybacks() {
    let mut v = setup();
    send(&mut v, "oneup", "alice", 100, r#"{"buyback":{"epoch":1,"per_market":[["NEAR","100"]]}}"#);
}

#[test]
#[should_panic(expected = "Not your lock")]
fn only_owner_votes() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 100, 2);
    vote(&mut v, "bob", &a, &[("NEAR", PPM)]);
}

const BOND: u128 = 500_000_000;

#[test]
fn proposal_lists_at_two_percent() {
    let mut v = setup();
    send(&mut v, "usdc", "project", BOND, r#"{"propose":{"market_id":"MEME-USD","feed_id":"meme"}}"#);
    let a = lock(&mut v, "alice", 9_800, 52);
    let b = lock(&mut v, "bob", 200, 52);
    vote(&mut v, "alice", &a, &[("NEAR-USD", PPM)]);
    vote(&mut v, "bob", &b, &[("MEME-USD", PPM)]);
    checkpoint(&mut v, 2); // MEME has exactly 2%
    assert!(v.get_proposals().is_empty());
}

#[test]
fn idle_proposal_is_dropped_after_four_epochs() {
    let mut v = setup();
    send(&mut v, "usdc", "project", BOND, r#"{"propose":{"market_id":"MEME-USD","feed_id":"meme"}}"#);
    let a = lock(&mut v, "alice", 1_000, 52);
    vote(&mut v, "alice", &a, &[("NEAR-USD", PPM)]);
    for e in 2..=4 {
        checkpoint(&mut v, e);
        assert_eq!(v.get_proposals()[0].idle, (e - 1) as u32);
    }
    checkpoint(&mut v, 5);
    assert!(v.get_proposals().is_empty());
}

#[test]
fn small_support_keeps_waiting() {
    let mut v = setup();
    send(&mut v, "usdc", "project", BOND, r#"{"propose":{"market_id":"MEME-USD","feed_id":"meme"}}"#);
    let a = lock(&mut v, "alice", 9_900, 52);
    let b = lock(&mut v, "bob", 100, 52);
    vote(&mut v, "alice", &a, &[("NEAR-USD", PPM)]);
    vote(&mut v, "bob", &b, &[("MEME-USD", PPM)]);
    for e in 2..=7 {
        checkpoint(&mut v, e);
    }
    let p = &v.get_proposals()[0];
    assert_eq!(p.idle, 0); // 1% isn't enough to list, but it isn't idle either
}

#[test]
#[should_panic(expected = "The bond is 500 USDC")]
fn bond_is_exact() {
    let mut v = setup();
    send(&mut v, "usdc", "project", BOND - 1, r#"{"propose":{"market_id":"MEME-USD","feed_id":"meme"}}"#);
}
