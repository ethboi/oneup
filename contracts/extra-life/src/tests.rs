use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};
use oneup_math::USDC;

use crate::{ExtraLife, MintItem};
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: u128) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .build());
}

fn setup() -> ExtraLife {
    ctx("owner", 0);
    near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
    ExtraLife::new(acc("owner"), acc("house"), acc("usdc"))
}

fn item(owner: &str, face: u128, cap_ppm: u128) -> MintItem {
    MintItem { owner: acc(owner), face: U128(face * USDC), cap_ppm: U128(cap_ppm) }
}

fn pot(c: &mut ExtraLife, amount: u128) -> u128 {
    ctx("usdc", 0);
    match c.ft_on_transfer(acc("house"), U128(amount * USDC), r#"{"epoch_pot":{"epoch":1}}"#.into()) {
        near_sdk::PromiseOrValue::Value(v) => v.0,
        _ => unreachable!(),
    }
}

#[test]
fn v1_v5_mint_and_pay() {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(0, vec![item("seed", 25_000, 1_000_000)]);
    // V1: Alice 1_000 face at 1.84× → 1_840; Bob 10_000 owed at 1.0×
    c.mint_batch(1, vec![item("alice", 1_000, 1_840_000), item("bob", 10_000, 1_000_000)]);
    let a = c.life_info("1:alice".into()).unwrap();
    assert_eq!(a.owed.0, 1_840 * USDC);
    assert_eq!(c.total_owed_remaining().0, 36_840 * USDC);

    assert_eq!(pot(&mut c, 18_000), 0);
    let paid = |c: &ExtraLife, id: &str| c.life_info(id.into()).unwrap().paid.0 / USDC;
    assert_eq!((paid(&c, "1:alice"), paid(&c, "1:bob"), paid(&c, "0:seed")), (899, 4_885, 12_214));

    // a pot bigger than everything owed pays all in full and returns the rest
    assert_eq!(pot(&mut c, 50_000), 31_160 * USDC);
    let a = c.life_info("1:alice".into()).unwrap();
    assert!(a.full_heal);
    assert_eq!(a.claimable.0, 1_840 * USDC);
}

#[test]
fn claimable_moves_with_the_token() {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 2_000_000)]);
    pot(&mut c, 500);
    ctx("alice", 1);
    c.nft_transfer(acc("bob"), "1:alice".into(), None, None);
    let l = c.life_info("1:alice".into()).unwrap();
    assert_eq!(l.owner_id, acc("bob"));
    assert_eq!(l.claimable.0, 500 * USDC);
    assert_eq!(c.lives_for_owner(acc("bob"), None, None).len(), 1);
}

#[test]
fn claim_marks_claimed() {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 2_000_000)]);
    pot(&mut c, 500);
    ctx("alice", 0);
    let _ = c.claim(vec!["1:alice".into()]);
    assert_eq!(c.life_info("1:alice".into()).unwrap().claimable.0, 0);
    assert_eq!(c.held().0, 0);
    pot(&mut c, 300);
    assert_eq!(c.life_info("1:alice".into()).unwrap().claimable.0, 300 * USDC);
}

#[test]
#[should_panic(expected = "Not your token")]
fn only_owner_claims() {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 2_000_000)]);
    pot(&mut c, 500);
    ctx("bob", 0);
    let _ = c.claim(vec!["1:alice".into()]);
}

#[test]
#[should_panic(expected = "Only the house")]
fn only_house_mints() {
    let mut c = setup();
    ctx("alice", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 2_000_000)]);
}

#[test]
#[should_panic(expected = "token_id must be unique")]
fn one_life_per_wallet_per_epoch() {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 2_000_000), item("alice", 5, 2_000_000)]);
}
