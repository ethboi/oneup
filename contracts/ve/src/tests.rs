use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_sdk::mock::MockAction;
use near_sdk::{testing_env, AccountId, NearToken, PromiseOrValue};
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

/// Lists a lock: the owner approves the market (approval id 1 for the first).
fn approve(v: &mut Ve, who: &str, id: &str) {
    testing_env!(VMContextBuilder::new().predecessor_account_id(acc(who)).attached_deposit(NearToken::from_millinear(10)).build());
    let _ = v.nft_approve(id.into(), acc("market"), Some(r#"{"price":"1"}"#.into()));
}

/// The market moves a lock with approval id 1.
fn market_sells(v: &mut Ve, id: &str) {
    testing_env!(VMContextBuilder::new().predecessor_account_id(acc("market")).attached_deposit(NearToken::from_yoctonear(1)).build());
    v.nft_transfer(acc("bob"), id.into(), Some(1), None);
}

fn approved(v: &Ve, id: &str) -> bool {
    v.nft_is_approved(id.into(), acc("market"), None)
}

/// $1UP sent by the receipts of the last call.
fn sent() -> u128 {
    near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .flat_map(|r| r.actions)
        .filter_map(|a| match a {
            MockAction::FunctionCallWeight { method_name, args, .. } if method_name == b"ft_transfer" => {
                let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(&args).unwrap();
                Some(v["amount"].as_str().unwrap().parse::<u128>().unwrap())
            }
            _ => None,
        })
        .sum()
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

#[test]
fn claim_many_pays_once_across_locks() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    let b = lock(&mut v, "alice", 1_040, 52);
    checkpoint(&mut v, 2);
    buyback(&mut v, 2, 300);
    checkpoint(&mut v, 3);
    // weights 1_000 : 520
    let (ca, cb) = (claimable(&v, &a, &[2]), claimable(&v, &b, &[2]));
    assert_eq!(ca + cb, oneup_math::pro_rata(300 * ONEUP, 1_000 * ONEUP, 1_520 * ONEUP) + oneup_math::pro_rata(300 * ONEUP, 520 * ONEUP, 1_520 * ONEUP));
    ctx("alice");
    v.claim_many(vec![a.clone(), b.clone()], vec![2]);
    assert_eq!(claimable(&v, &a, &[2]) + claimable(&v, &b, &[2]), 0);
}

#[test]
fn merge_combines_and_routes_unclaimed_rewards() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104); // ends 106
    let b = lock(&mut v, "alice", 1_040, 52); // ends 54, weighs 520 at epoch 2
    checkpoint(&mut v, 2);
    buyback(&mut v, 2, 300);
    checkpoint(&mut v, 3);
    let share_a = claimable(&v, &a, &[2]);
    let share_b = claimable(&v, &b, &[2]);
    // Alice claims A's epoch-2 share, then merges A and B in epoch 3
    ctx("alice");
    v.claim(a.clone(), vec![2]);
    let c = v.merge(vec![a.clone(), b.clone()]);
    let info = v.lock_info(c.clone()).unwrap();
    assert_eq!((info.amount.0, info.end, info.merged), (2_040 * ONEUP, 106, 2));
    // only the merged lock is listed; B's unclaimed epoch-2 share comes through it, A's isn't paid twice
    let mine: Vec<String> = v.locks_for_owner(acc("alice")).into_iter().map(|l| l.token_id).collect();
    assert_eq!(mine, vec![c.clone()]);
    assert_eq!(claimable(&v, &c, &[2]), share_b);
    assert!(share_a > 0);
    // the old locks still earn epoch 3 (their weight was fixed for it); C counts from epoch 4
    buyback(&mut v, 3, 100);
    checkpoint(&mut v, 4);
    assert!(claimable(&v, &c, &[3]) > 99 * ONEUP);
    // and the next epoch's total has only C in it, at its full weight
    assert_eq!(v.get_total_power(4).0, oneup_math::ve_power(2_040 * ONEUP, 102));
}

#[test]
#[should_panic(expected = "Merged into another lock")]
fn merged_locks_cannot_be_claimed_directly() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    let b = lock(&mut v, "alice", 1_000, 104);
    checkpoint(&mut v, 2);
    ctx("alice");
    v.merge(vec![a.clone(), b]);
    checkpoint(&mut v, 3);
    ctx("alice");
    v.claim(a, vec![2]);
}

#[test]
#[should_panic(expected = "Not your lock")]
fn cannot_merge_someone_elses_lock() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    let b = lock(&mut v, "bob", 1_000, 104);
    ctx("alice");
    v.merge(vec![a, b]);
}

#[test]
#[should_panic(expected = "Lock is closed")]
fn exited_lock_cannot_be_sold_through_a_stale_approval() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    approve(&mut v, "alice", &a);
    checkpoint(&mut v, 2);
    ctx("alice");
    v.exit_early(a.clone());
    assert!(!approved(&v, &a));
    market_sells(&mut v, &a);
}

#[test]
#[should_panic(expected = "Lock is closed")]
fn merged_lock_cannot_be_sold_through_a_stale_approval() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    let b = lock(&mut v, "alice", 1_000, 104);
    approve(&mut v, "alice", &a);
    approve(&mut v, "alice", &b);
    ctx("alice");
    v.merge(vec![a.clone(), b.clone()]);
    assert!(!approved(&v, &a) && !approved(&v, &b));
    market_sells(&mut v, &a);
}

#[test]
#[should_panic(expected = "Lock is closed")]
fn unlocked_lock_cannot_be_sold_through_a_stale_approval() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 1);
    approve(&mut v, "alice", &a);
    checkpoint(&mut v, 2);
    checkpoint(&mut v, 3);
    ctx("alice");
    v.unlock(a.clone());
    assert!(!approved(&v, &a));
    market_sells(&mut v, &a);
}

#[test]
#[should_panic(expected = "Lock is closed")]
fn closed_lock_cannot_be_approved() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    checkpoint(&mut v, 2);
    ctx("alice");
    v.exit_early(a.clone());
    approve(&mut v, "alice", &a);
}

#[test]
#[should_panic(expected = "Lock is closed")]
fn closed_lock_cannot_be_transferred() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    checkpoint(&mut v, 2);
    ctx("alice");
    v.exit_early(a.clone());
    testing_env!(VMContextBuilder::new().predecessor_account_id(acc("alice")).attached_deposit(NearToken::from_yoctonear(1)).build());
    v.nft_transfer(acc("bob"), a, None, None);
}

#[test]
fn open_lock_still_sells() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    approve(&mut v, "alice", &a);
    market_sells(&mut v, &a);
    assert_eq!(v.lock_info(a).unwrap().owner_id, acc("bob"));
}

#[test]
fn claiming_drops_the_approvals() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    let b = lock(&mut v, "alice", 1_000, 104);
    checkpoint(&mut v, 2);
    approve(&mut v, "alice", &a);
    approve(&mut v, "alice", &b);
    buyback(&mut v, 2, 100);
    checkpoint(&mut v, 3);
    ctx("alice");
    v.claim(a.clone(), vec![2]);
    // the claimed lock's listing is gone; the other's stands
    assert!(!approved(&v, &a));
    assert!(approved(&v, &b));
}

#[test]
#[should_panic(expected = "Lock at least 1 $1UP")]
fn dust_locks_are_refused() {
    let mut v = setup();
    send(&mut v, "alice", 1, r#"{"lock":{"epochs":104}}"#);
}

#[test]
fn small_loser_locks_are_kept() {
    let mut v = setup();
    send(&mut v, "house", 3, r#"{"lock_for":{"items":[["alice","1"],["bob","2"]]}}"#);
    assert_eq!(v.locks_for_owner(acc("bob"))[0].amount.0, 2);
}

#[test]
#[should_panic(expected = "Lock has ended")]
fn merge_rejects_an_ended_lock() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 1);
    let b = lock(&mut v, "alice", 1_000, 104);
    checkpoint(&mut v, 2);
    checkpoint(&mut v, 3);
    ctx("alice");
    v.merge(vec![b, a]);
}

#[test]
#[should_panic(expected = "Lock listed twice")]
fn merge_rejects_a_duplicate() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    ctx("alice");
    v.merge(vec![a.clone(), a]);
}

#[test]
#[should_panic(expected = "Lock already closed")]
fn merge_rejects_a_merged_lock() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    let b = lock(&mut v, "alice", 1_000, 104);
    let c = lock(&mut v, "alice", 1_000, 104);
    ctx("alice");
    v.merge(vec![a.clone(), b]);
    v.merge(vec![a, c]);
}

#[test]
fn late_buyback_through_a_merged_lock_pays_only_the_difference() {
    let mut v = setup();
    let a = lock(&mut v, "alice", 1_000, 104);
    let b = lock(&mut v, "alice", 1_000, 104);
    let _bob = lock(&mut v, "bob", 2_000, 104);
    checkpoint(&mut v, 2);
    buyback(&mut v, 2, 400);
    checkpoint(&mut v, 3);
    ctx("alice");
    let c = v.merge(vec![a, b]);
    // A and B each weigh a quarter of epoch 2
    ctx("alice");
    v.claim(c.clone(), vec![2]);
    assert_eq!(sent(), 200 * ONEUP);
    buyback(&mut v, 2, 40);
    assert_eq!(claimable(&v, &c, &[2]), 20 * ONEUP);
    ctx("alice");
    v.claim(c.clone(), vec![2]);
    assert_eq!(sent(), 20 * ONEUP);
    assert_eq!(claimable(&v, &c, &[2]), 0);
}
