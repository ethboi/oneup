use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, PromiseOrValue};
use oneup_math::ONEUP;

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
    Ve::new(acc("owner"), acc("house"), acc("oneup"))
}

fn send(v: &mut Ve, sender: &str, amount: u128, msg: &str) -> u128 {
    ctx("oneup");
    match v.ft_on_transfer(acc(sender), U128(amount), msg.into()) {
        PromiseOrValue::Value(x) => x.0,
        _ => unreachable!(),
    }
}

fn lock(v: &mut Ve, who: &str, amount: u128, epochs: u64) -> String {
    send(v, who, amount * ONEUP, &format!(r#"{{"lock":{{"epochs":{epochs}}}}}"#));
    (v.next_lock - 1).to_string()
}

fn checkpoint(v: &mut Ve, e: u64) {
    ctx("house");
    v.checkpoint(e);
}

fn buyback(v: &mut Ve, epoch: u64, amount: u128) {
    send(v, "house", amount * ONEUP, &format!(r#"{{"buyback":{{"epoch":{epoch}}}}}"#));
}

fn claimable(v: &Ve, id: &str, epochs: &[u64]) -> u128 {
    v.get_claimable(id.into(), epochs.to_vec()).0
}

#[test]
fn lock_counts_from_the_next_epoch_and_decays() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    let b = lock(&mut v, "bob", 1_040, 52);
    assert_eq!(v.lock_info(a.clone()).unwrap().power.0, 1_000 * ONEUP);
    checkpoint(&mut v, 2);
    // Alice 1_000 at full weight; Bob's 52-epoch lock weighs half
    assert_eq!(v.get_total_power(2).0, 1_000 * ONEUP + 520 * ONEUP);
    checkpoint(&mut v, 3);
    assert_eq!(v.get_total_power(3).0, 1_000 * ONEUP * 103 / 104 + 1_040 * ONEUP * 51 / 104);
    assert!(!v.lock_info(b).unwrap().from_loss);
}

#[test]
fn buybacks_are_shared_by_weight() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    let b = lock(&mut v, "bob", 1_000, 52);
    checkpoint(&mut v, 2);
    buyback(&mut v, 2, 300);
    checkpoint(&mut v, 3);
    // weights 1_000 : 500
    assert_eq!(claimable(&v, &a, &[2]), 200 * ONEUP);
    assert_eq!(claimable(&v, &b, &[2]), 100 * ONEUP);
    // a lock made during epoch 2 doesn't earn epoch 2
    let c = lock(&mut v, "carol", 5_000, 104);
    assert_eq!(claimable(&v, &c, &[2]), 0);
}

#[test]
fn claim_pays_once() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    checkpoint(&mut v, 2);
    buyback(&mut v, 2, 50);
    checkpoint(&mut v, 3);
    ctx("alice");
    v.claim(a.clone(), vec![2]);
    assert_eq!(claimable(&v, &a, &[2]), 0);
    // a late buyback for the same epoch is claimable on top
    buyback(&mut v, 2, 10);
    assert_eq!(claimable(&v, &a, &[2]), 10 * ONEUP);
}

#[test]
#[should_panic(expected = "Not your lock")]
fn only_the_owner_claims() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    checkpoint(&mut v, 2);
    ctx("bob");
    v.claim(a, vec![1]);
}

#[test]
fn exit_early_pays_the_stayers() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    let b = lock(&mut v, "bob", 1_000, 104);
    checkpoint(&mut v, 2);
    // in epoch 2, Alice's lock ends at 106: 103 epochs left after this one
    assert_eq!(v.lock_info(a.clone()).unwrap().exit_penalty.0, oneup_math::exit_penalty(1_000 * ONEUP, 103));
    ctx("alice");
    let penalty = v.exit_early(a.clone()).0;
    assert_eq!(penalty, oneup_math::exit_penalty(1_000 * ONEUP, 103));
    // she still earns epoch 2; the penalty goes to epoch 3's lockers, which is only Bob
    buyback(&mut v, 2, 100);
    checkpoint(&mut v, 3);
    assert_eq!(v.get_total_power(3).0, 1_000 * ONEUP * 103 / 104);
    checkpoint(&mut v, 4);
    assert_eq!(claimable(&v, &a, &[2, 3]), 50 * ONEUP);
    assert_eq!(claimable(&v, &b, &[2, 3]), 50 * ONEUP + penalty);
    let info = v.lock_info(a).unwrap();
    assert!(info.withdrawn && info.exited == Some(2) && info.power.0 == 0);
}

#[test]
#[should_panic(expected = "Lock has ended")]
fn no_early_exit_after_the_end() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 1);
    checkpoint(&mut v, 2);
    checkpoint(&mut v, 3);
    ctx("alice");
    v.exit_early(a);
}

#[test]
fn unlock_after_the_end() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 1);
    checkpoint(&mut v, 2);
    checkpoint(&mut v, 3);
    assert_eq!(v.lock_info(a.clone()).unwrap().exit_penalty.0, 0);
    ctx("alice");
    v.unlock(a.clone());
    assert!(v.lock_info(a).unwrap().withdrawn);
}

#[test]
fn house_locks_for_losers() {
    let mut v = setup();
    send(&mut v, "house", 300 * ONEUP, r#"{"lock_for":{"items":[["alice","100000000000000000000"],["bob","200000000000000000000"]]}}"#);
    let locks = v.locks_for_owner(acc("bob"));
    assert_eq!(locks.len(), 1);
    assert!(locks[0].from_loss);
    assert_eq!(locks[0].amount.0, 200 * ONEUP);
    assert_eq!(locks[0].end, 1 + 1 + 104);
}

#[test]
#[should_panic(expected = "Only the house")]
fn only_the_house_locks_for_others() {
    let mut v = setup();
    send(&mut v, "mallory", 100 * ONEUP, r#"{"lock_for":{"items":[["mallory","100000000000000000000"]]}}"#);
}

#[test]
#[should_panic(expected = "Locks don't add up")]
fn lock_for_must_add_up() {
    let mut v = setup();
    send(&mut v, "house", 300 * ONEUP, r#"{"lock_for":{"items":[["alice","100000000000000000000"]]}}"#);
}

#[test]
fn buyback_with_nobody_locked_rolls_forward() {
    let mut v = setup();
    checkpoint(&mut v, 2);
    buyback(&mut v, 2, 70);
    // epoch 2 had no weight: the 70 waits for epoch 3
    assert_eq!(v.get_rewards(3).0, 70 * ONEUP);
    let a = lock(&mut v, "alice", 1_000, 104);
    checkpoint(&mut v, 3);
    checkpoint(&mut v, 4);
    assert_eq!(claimable(&v, &a, &[3]), 70 * ONEUP);
}

#[test]
#[should_panic(expected = "Only $1UP")]
fn only_oneup_is_accepted() {
    let mut v = setup();
    ctx("usdc");
    let _ = v.ft_on_transfer(acc("alice"), U128(1), r#"{"lock":{"epochs":10}}"#.into());
}
