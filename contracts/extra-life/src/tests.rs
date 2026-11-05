use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken, PromiseError};
use oneup_math::USDC;
use proptest::prelude::*;

use crate::{ExtraLife, MintItem};
use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
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
    c.mint_backer(acc("seed"), U128(25_000 * USDC), U128(1_000_000));
    // V1: Alice 1_000 face at 1.84× → 1_840; Bob 10_000 owed at 1.0×
    c.mint_batch(1, vec![item("alice", 1_000, 1_840_000), item("bob", 10_000, 1_000_000)]);
    let a = c.life_info("1:alice".into()).unwrap();
    assert_eq!(a.owed.0, 1_840 * USDC);
    assert_eq!(c.total_owed_remaining().0, 36_840 * USDC);

    // all of it used, less a few micro-USDC of rounding (lives are paid down, never up)
    let dust = pot(&mut c, 18_000);
    assert!(dust <= 3);
    let paid = |c: &ExtraLife, id: &str| c.life_info(id.into()).unwrap().paid.0 / USDC;
    assert_eq!((paid(&c, "1:alice"), paid(&c, "1:bob"), paid(&c, "b1")), (1_840, 10_000, 6_160));

    // a pot bigger than everything owed pays all in full and returns the rest
    assert_eq!(pot(&mut c, 50_000), 31_160 * USDC - dust);
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
#[should_panic(expected = "Conflicting Life entitlement")]
fn one_life_per_wallet_per_epoch() {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 2_000_000), item("alice", 5, 2_000_000)]);
}

#[test]
fn expired_lives_keep_what_they_earned() {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 1_000_000)]);
    pot(&mut c, 400);
    ctx("house", 0);
    c.mint_batch(2, vec![item("bob", 1_000, 1_000_000)]);
    assert_eq!(c.expire(1).0, 1_000 * USDC); // Alice's 600 unpaid drops out; Bob's 1_000 is all that is owed
    pot(&mut c, 500);
    let a = c.life_info("1:alice".into()).unwrap();
    assert!(a.expired && !a.full_heal);
    assert_eq!(a.paid.0, 400 * USDC);
    assert_eq!(c.life_info("2:bob".into()).unwrap().paid.0, 500 * USDC);
    // expiring again is a no-op
    ctx("house", 0);
    assert_eq!(c.expire(1).0, 500 * USDC);
}

#[test]
#[should_panic(expected = "Epoch already expired")]
fn no_minting_into_an_expired_epoch() {
    let mut c = setup();
    ctx("house", 0);
    c.expire(3);
    c.mint_batch(2, vec![item("alice", 1_000, 1_000_000)]);
}

#[test]
fn metadata_is_drawn_from_the_life() {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(0, vec![item("seed", 1_000, 1_000_000)]);
    c.mint_batch(1, vec![item("alice", 1_000, 1_000_000)]);
    let media = |c: &ExtraLife| c.nft_token("1:alice".into()).unwrap().metadata.unwrap().media.unwrap();
    let before = media(&c);
    assert!(before.starts_with("data:image/svg+xml;utf8,<svg"));
    // nothing paid: no heart-coloured cells yet
    assert!(!before.contains("e2257a"));
    pot(&mut c, 1_000);
    let half = c.nft_token("1:alice".into()).unwrap().metadata.unwrap();
    assert!(half.media.as_ref().unwrap().contains("e2257a"));
    assert!(half.description.unwrap().starts_with("Paid 500.00 of 1000.00 USDC"));
    pot(&mut c, 5_000);
    let healed = c.nft_token("1:alice".into()).unwrap().metadata.unwrap();
    assert!(healed.media.unwrap().contains("f2b705"));
    assert!(healed.extra.unwrap().contains(r#""state":"full_heal""#));
}

fn backer(c: &mut ExtraLife, owner: &str, face: u128) -> String {
    ctx("house", 0);
    c.mint_backer(acc(owner), U128(face * USDC), U128(1_000_000))
}

fn claimed(c: &ExtraLife, id: &str) -> u128 {
    c.lives.get(&id.to_string()).unwrap().claimed
}

#[test]
fn claim_drops_the_approvals() {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 2_000_000)]);
    ctx("alice", 10_000_000_000_000_000_000_000);
    let _ = c.nft_approve("1:alice".into(), acc("market"), Some(r#"{"price":"1"}"#.into()));
    assert!(c.nft_is_approved("1:alice".into(), acc("market"), None));
    pot(&mut c, 500);
    ctx("alice", 0);
    let _ = c.claim(vec!["1:alice".into()]);
    assert!(!c.nft_is_approved("1:alice".into(), acc("market"), None));
}

#[test]
fn claim_never_records_more_than_it_sends() {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 1_000_000), item("bob", 1_000, 1_000_000)]);
    let b = backer(&mut c, "alice", 1_000);
    pot(&mut c, 900); // losers 600 (300 each), the backer 300
    c.held = 500 * USDC; // short of the 600 claimable
    ctx("alice", 0);
    let _ = c.claim(vec!["1:alice".into(), b.clone()]);
    assert_eq!(c.held, 0);
    // the first is paid in full, the last only what was left; the rest stays claimable
    assert_eq!((claimed(&c, "1:alice"), claimed(&c, &b)), (300 * USDC, 200 * USDC));
    assert_eq!(c.life_info(b).unwrap().claimable.0, 100 * USDC);
}

#[test]
fn failed_claim_restores_exactly_its_amounts() {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 1_000_000)]);
    let b = backer(&mut c, "alice", 1_000);
    pot(&mut c, 300); // Alice 200, the backer 100 (two thirds, one third)
    ctx("alice", 0);
    let _ = c.claim(vec![b.clone()]);
    pot(&mut c, 150); // 100 and 50 more
    ctx("alice", 0);
    let _ = c.claim(vec!["1:alice".into(), b.clone()]);
    assert_eq!((claimed(&c, "1:alice"), claimed(&c, &b)), (300 * USDC, 150 * USDC));
    // the second transfer fails: only its 300 + 50 come back, not the backer's earlier 100
    c.on_claim(acc("alice"), vec![("1:alice".into(), U128(300 * USDC)), (b.clone(), U128(50 * USDC))], U128(350 * USDC), Err(PromiseError::Failed));
    assert_eq!((claimed(&c, "1:alice"), claimed(&c, &b)), (0, 100 * USDC));
    assert_eq!(c.held, 350 * USDC);
}

#[test]
#[should_panic(expected = "Claim 1 to 30 tokens")]
fn claim_is_capped_at_30() {
    let mut c = setup();
    ctx("alice", 0);
    let _ = c.claim(vec!["1:alice".to_string(); 31]);
}

#[test]
fn one_owner_can_back_twice() {
    let mut c = setup();
    let a = backer(&mut c, "alice", 1_000);
    let b = backer(&mut c, "alice", 500);
    assert_eq!((a.as_str(), b.as_str()), ("b1", "b2"));
    let lives = c.lives_for_owner(acc("alice"), None, None);
    assert_eq!(lives.len(), 2);
    assert!(lives.iter().all(|l| l.backer && l.epoch == 0));
    let t = c.nft_token(a).unwrap().metadata.unwrap();
    assert_eq!(t.title.unwrap(), "Backer Life #1");
    assert!(t.media.unwrap().contains("b98b00"));
    // the old epoch-0 path still works after a backing
    ctx("house", 0);
    c.mint_batch(0, vec![item("seed", 1_000, 1_000_000)]);
    assert!(!c.life_info("0:seed".into()).unwrap().backer);
}

#[test]
#[should_panic(expected = "Only the house")]
fn only_the_house_mints_backers() {
    let mut c = setup();
    ctx("alice", 0);
    c.mint_backer(acc("alice"), U128(USDC), U128(1_000_000));
}

#[test]
fn backer_earns_only_from_later_pots() {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 1_000_000)]);
    pot(&mut c, 500); // all Alice's
    let b = backer(&mut c, "bob", 500);
    // shared by what each was owed (D-25): Alice 1_000, Bob 500, so 2 : 1 even though Alice is half paid
    pot(&mut c, 500);
    // and two thirds to losers (D-26) gives the same 2 : 1 here
    assert_eq!(c.life_info(b).unwrap().paid.0, 166_666_667);
    assert_eq!(c.life_info("1:alice".into()).unwrap().paid.0, 833_333_333); // the pot is spent exactly: 500 in all
}

#[test]
fn backers_never_expire_and_full_heal() {
    let mut c = setup();
    let b = backer(&mut c, "bob", 1_000);
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 1_000_000)]);
    pot(&mut c, 1_500); // Alice's two thirds pay her in full, the backer's third is 500
    ctx("house", 0);
    assert_eq!(c.expire(50).0, 500 * USDC); // Alice is done; the backer's 500 stays owed
    let info = c.life_info(b.clone()).unwrap();
    assert!(!info.expired && info.paid.0 == 500 * USDC);
    assert_eq!(pot(&mut c, 2_000), 1_500 * USDC);
    let info = c.life_info(b.clone()).unwrap();
    assert!(info.full_heal && !info.expired && info.claimable.0 == 1_000 * USDC);
    let t = c.nft_token(b).unwrap().metadata.unwrap();
    assert!(t.extra.unwrap().contains(r#""state":"full_heal","backer":true"#));
    assert!(t.description.unwrap().ends_with("Backed the house pool."));
}

#[derive(Debug, Clone)]
enum Op {
    Mint(u8, u128),
    Back(u8, u128),
    Pot(u128),
    Expire,
    Claim(u8),
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        (0u8..4, 1u128..10_000_000_000).prop_map(|(o, f)| Op::Mint(o, f)),
        (0u8..4, 1u128..10_000_000_000).prop_map(|(o, f)| Op::Back(o, f)),
        (0u128..20_000_000_000).prop_map(Op::Pot),
        Just(Op::Expire),
        (0u8..4).prop_map(Op::Claim),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Claims never send more than the pots brought in, and no life claims more than it was paid.
    #[test]
    fn claims_never_exceed_pots(ops in prop::collection::vec(op(), 1..40)) {
        let mut c = setup();
        let owners = ["alice", "bob", "carol", "dave"];
        let (mut epoch, mut received, mut sent) = (1u64, 0u128, 0u128);
        let mut ids: Vec<(String, usize)> = vec![];
        for o in ops {
            match o {
                Op::Mint(w, face) => {
                    ctx("house", 0);
                    // one life per owner per epoch: a repeat moves to a new epoch
                    if ids.iter().any(|(id, _)| *id == crate::token_id(epoch, &acc(owners[w as usize]))) { epoch += 1; }
                    let minted = c.mint_batch(epoch, vec![MintItem { owner: acc(owners[w as usize]), face: U128(face), cap_ppm: U128(1_500_000) }]);
                    ids.extend(minted.into_iter().map(|id| (id, w as usize)));
                }
                Op::Back(w, face) => {
                    ctx("house", 0);
                    ids.push((c.mint_backer(acc(owners[w as usize]), U128(face), U128(1_000_000)), w as usize));
                }
                Op::Pot(p) => {
                    ctx("usdc", 0);
                    if let near_sdk::PromiseOrValue::Value(back) = c.ft_on_transfer(acc("house"), U128(p), r#"{"epoch_pot":{"epoch":1}}"#.into()) {
                        received += p - back.0;
                    }
                    epoch += 1; // a pot ends the epoch: later lives join the next cohort
                }
                Op::Expire => {
                    ctx("house", 0);
                    c.expire(epoch - 1);
                }
                Op::Claim(w) => {
                    let mine: Vec<String> = ids.iter().filter(|(_, o)| *o == w as usize).map(|(id, _)| id.clone()).take(30).collect();
                    let claimable: u128 = mine.iter().map(|id| c.life_info(id.clone()).unwrap().claimable.0).sum();
                    if claimable > 0 && c.held > 0 {
                        let before = c.held;
                        ctx(owners[w as usize], 0);
                        let _ = c.claim(mine);
                        sent += before - c.held;
                    }
                }
            }
            prop_assert!(sent <= received, "sent {} received {}", sent, received);
            prop_assert_eq!(received - sent, c.held);
            for (id, _) in &ids {
                let l = c.lives.get(id).unwrap();
                prop_assert!(l.claimed <= c.life_info(id.clone()).unwrap().paid.0);
            }
        }
    }
}

#[test]
fn losers_get_two_thirds_backers_one_third() {
    let mut c = setup();
    let b = backer(&mut c, "bob", 1_000_000);
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 1_000_000)]);
    // backers are owed 1000× more, but get only their third
    pot(&mut c, 900);
    assert_eq!(c.life_info("1:alice".into()).unwrap().paid.0, 600 * USDC);
    assert_eq!(c.life_info(b).unwrap().paid.0, 300 * USDC);
}

#[test]
fn a_side_passes_on_what_it_cant_use() {
    let mut c = setup();
    let b = backer(&mut c, "bob", 1_000_000);
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 100, 1_000_000)]);
    // Alice can take only 100 of her 2_000 slice: the rest goes to the backer
    assert_eq!(pot(&mut c, 3_000), 0);
    assert!(c.life_info("1:alice".into()).unwrap().full_heal);
    assert_eq!(c.life_info(b).unwrap().paid.0, 2_900 * USDC);
}

#[test]
fn retrying_a_mint_after_sale_and_payout_keeps_the_current_owner_and_terms() {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 2_000_000)]);
    pot(&mut c, 400);
    ctx("alice", 1);
    c.nft_transfer(acc("bob"), "1:alice".into(), None, None);
    let owed = c.total_owed_remaining().0;
    ctx("house", 0);
    for _ in 0..3 {
        assert_eq!(c.mint_batch(1, vec![item("alice", 1_000, 2_000_000)]), vec!["1:alice"]);
    }
    let life = c.life_info("1:alice".into()).unwrap();
    assert_eq!(life.owner_id, acc("bob"));
    assert_eq!(life.claimable.0, 400 * USDC);
    assert_eq!(life.owed.0, 2_000 * USDC);
    assert_eq!(c.total_owed_remaining().0, owed);
    assert_eq!(c.tokens.owner_by_id.len(), 1);
}

/// The owner (the DAO, in the local deployment) is the only one who can point the Lives at another house.
#[test]
#[should_panic(expected = "Only the owner")]
fn only_the_owner_repoints_the_house() {
    let mut c = setup();
    ctx("house", 0);
    c.set_house(acc("mallory"));
}

#[test]
#[should_panic(expected = "Only the house")]
fn once_repointed_the_old_house_cannot_mint() {
    let mut c = setup();
    assert_eq!(c.get_owner(), acc("owner"));
    ctx("owner", 0);
    c.set_house(acc("house2"));
    ctx("house", 0);
    c.mint_backer(acc("seed"), U128(USDC), U128(1_000_000));
}

/// Runs the transfer call's callback as the chain would, with the receiver's answer (true: give it back).
fn resolve(c: &mut ExtraLife, from: &str, to: &str, id: &str, approvals: Option<std::collections::HashMap<AccountId, u64>>) -> bool {
    testing_env!(
        VMContextBuilder::new().predecessor_account_id(near_sdk::test_utils::accounts(0)).current_account_id(near_sdk::test_utils::accounts(0)).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![near_sdk::PromiseResult::Successful(b"true".to_vec())],
    );
    use near_contract_standards::non_fungible_token::core::NonFungibleTokenResolver;
    c.nft_resolve_transfer(acc(from), acc(to), id.into(), approvals)
}

fn old_approval() -> Option<std::collections::HashMap<AccountId, u64>> {
    Some(std::iter::once((acc("market"), 1)).collect())
}

fn life_in_flight_to_helper() -> ExtraLife {
    let mut c = setup();
    ctx("house", 0);
    c.mint_batch(1, vec![item("alice", 1_000, 2_000_000)]);
    pot(&mut c, 500);
    ctx("alice", 1);
    let _ = c.nft_transfer_call(acc("helper"), "1:alice".into(), None, None, "".into());
    c
}

#[test]
fn a_life_emptied_during_a_transfer_call_returns_without_its_old_approvals() {
    let mut c = life_in_flight_to_helper();
    ctx("helper", 0);
    let _ = c.claim(vec!["1:alice".into()]);
    assert!(!resolve(&mut c, "alice", "helper", "1:alice", old_approval()));
    assert_eq!(c.tokens.owner_by_id.get(&"1:alice".to_string()), Some(acc("alice")));
    assert!(!c.nft_is_approved("1:alice".into(), acc("market"), None));
    assert!(c.in_flight.get(&"1:alice".to_string()).is_none());
}

#[test]
fn a_life_untouched_during_a_transfer_call_gets_its_approvals_back() {
    let mut c = life_in_flight_to_helper();
    assert!(!resolve(&mut c, "alice", "helper", "1:alice", old_approval()));
    assert_eq!(c.tokens.owner_by_id.get(&"1:alice".to_string()), Some(acc("alice")));
    assert!(c.nft_is_approved("1:alice".into(), acc("market"), Some(1)));
    assert!(c.in_flight.get(&"1:alice".to_string()).is_none());
}

#[test]
fn a_nested_transfer_call_cannot_wipe_the_mark() {
    let mut c = life_in_flight_to_helper();
    ctx("helper", 0);
    let _ = c.claim(vec!["1:alice".into()]);
    ctx("helper", 1);
    let _ = c.nft_transfer_call(acc("helper2"), "1:alice".into(), None, None, "".into());
    assert!(!resolve(&mut c, "helper", "helper2", "1:alice", None));
    assert!(!resolve(&mut c, "alice", "helper", "1:alice", old_approval()));
    assert_eq!(c.tokens.owner_by_id.get(&"1:alice".to_string()), Some(acc("alice")));
    assert!(!c.nft_is_approved("1:alice".into(), acc("market"), None));
}
