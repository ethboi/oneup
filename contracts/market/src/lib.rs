//! Marketplace for Life NFTs and $1UP locks (D-17).
//!
//! List: `nft_approve(token_id, market, msg = {"price":"<USDC>"})` on the NFT contract; it calls
//! `nft_on_approve` here. Buy: one USDC `ft_transfer_call` to the market with
//! `{"buy":{"nft_contract":…,"token_id":…,"price":"<USDC>","approval_id":…}}`; `price` and `approval_id` must
//! match the listing, so a seller can't re-price it under a buyer who sent more, or claim a Life's USDC and list
//! it again at the same price while the purchase is in flight. The NFT moves straight from seller to buyer through the
//! approval and the seller is paid; if the NFT can't move (sold elsewhere, approval revoked), the buyer's
//! USDC goes back. The market never holds NFTs, and holds USDC only while a purchase is in flight.

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApprovalReceiver;
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, PromiseError,
    PromiseOrValue,
};

/** The most the house can take of a sale. */
const MAX_FEE_PPM: u128 = 100_000;
const GAS_NFT_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_ON_BOUGHT: Gas = Gas::from_tgas(80);
const GAS_BUY_OVERHEAD: Gas = Gas::from_tgas(20);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_ON_PAID: Gas = Gas::from_tgas(5);
const MAX_LISTINGS_PAGE: u32 = 100;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Listing {
    pub nft_contract: AccountId,
    pub token_id: TokenId,
    pub seller: AccountId,
    pub approval_id: u64,
    /// USDC, 1e6.
    pub price: U128,
    /// Block time in seconds.
    pub listed_at: u64,
}

#[near(serializers = [json])]
struct ListMsg {
    price: U128,
}

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
enum BuyMsg {
    /// `price` and `approval_id`: the listing the buyer saw. A claim drops a token's approvals, so a Life
    /// listed again after paying out has a new `approval_id`, even at the same price.
    Buy { nft_contract: AccountId, token_id: TokenId, price: U128, approval_id: u64 },
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Listings,
    Owed,
}

#[allow(dead_code)]
#[ext_contract(ext_nft)]
trait Nft {
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>);
}

#[allow(dead_code)]
#[ext_contract(ext_ft)]
trait Ft {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> U128;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Market {
    usdc: AccountId,
    /// NFT contracts that can be listed: the Life NFT and ve contracts.
    nft_contracts: Vec<AccountId>,
    listings: IterableMap<(AccountId, TokenId), Listing>,
    /// USDC owed to sellers after a failed payout.
    owed: LookupMap<AccountId, u128>,
    /// D-28: the house takes `fee_ppm` of each sale (its share counts as house profit).
    house: Option<AccountId>,
    fee_ppm: u128,
}

#[near]
impl Market {
    #[init]
    pub fn new(usdc: AccountId, nft_contracts: Vec<AccountId>, house: Option<AccountId>, fee_ppm: Option<U128>) -> Self {
        let fee_ppm = fee_ppm.map_or(0, |f| f.0);
        require!(fee_ppm <= MAX_FEE_PPM, "Fee above 10%");
        Self {
            usdc,
            nft_contracts,
            listings: IterableMap::new(StorageKey::Listings),
            owed: LookupMap::new(StorageKey::Owed),
            house,
            fee_ppm,
        }
    }

    pub fn get_fee(&self) -> (Option<AccountId>, U128) {
        (self.house.clone(), U128(self.fee_ppm))
    }

    /// Seller only: takes a listing down. (The approval stays on the NFT until revoked, but nothing can be
    /// bought without a listing.)
    pub fn delist(&mut self, nft_contract: AccountId, token_id: TokenId) {
        let key = (nft_contract, token_id);
        let l = self.listings.get(&key).unwrap_or_else(|| env::panic_str("Not listed"));
        require!(l.seller == env::predecessor_account_id(), "Not your listing");
        self.listings.remove(&key);
    }

    /// Buys with USDC: `{"buy":{"nft_contract","token_id","price","approval_id"}}`. Fails (refunding all)
    /// unless `price` and `approval_id` are the listing's; anything sent above the price is refunded.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "Pay in USDC");
        let BuyMsg::Buy { nft_contract, token_id, price, approval_id } =
            near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Bad message"));
        let key = (nft_contract.clone(), token_id.clone());
        let l = self.listings.get(&key).cloned().unwrap_or_else(|| env::panic_str("Not listed"));
        require!(price.0 == l.price.0, "Price changed");
        require!(approval_id == l.approval_id, "Listing changed");
        require!(amount.0 >= l.price.0, "Below the price");
        require!(sender_id != l.seller, "That's your own listing");
        // Reserve settlement gas before the irreversible NFT receipt. Caller-selected gas must not
        // make a later callback fail and refund a buyer who already owns the NFT.
        require!(env::prepaid_gas().saturating_sub(env::used_gas()) >= GAS_NFT_TRANSFER.saturating_add(GAS_ON_BOUGHT).saturating_add(GAS_BUY_OVERHEAD), "Insufficient gas for purchase settlement");
        // taken down now so it can't be bought twice while the transfer is in flight
        self.listings.remove(&key);
        ext_nft::ext(nft_contract)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_NFT_TRANSFER)
            .nft_transfer(sender_id.clone(), token_id, Some(l.approval_id), Some("OneUp market".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_BOUGHT).with_unused_gas_weight(0).on_bought(l, sender_id, amount))
            .into()
    }

    /// Returns the USDC the buyer gets back: the change if the NFT moved, everything if it didn't.
    #[private]
    pub fn on_bought(&mut self, listing: Listing, buyer: AccountId, amount: U128, #[callback_result] moved: Result<(), PromiseError>) -> U128 {
        if moved.is_err() {
            env::log_str(&format!("{} #{} couldn't move; refunding {}", listing.nft_contract, listing.token_id, buyer));
            return amount;
        }
        // the house's cut (D-28), rounded down; the seller gets the rest
        let fee = if self.house.is_some() { listing.price.0 * self.fee_ppm / 1_000_000 } else { 0 };
        self.pay(listing.seller.clone(), listing.price.0 - fee);
        if fee > 0 {
            self.pay_house(fee);
        }
        near_sdk::log!(
            r#"EVENT_JSON:{{"standard":"oneup_market","version":"1.0.0","event":"sold","data":[{{"nft_contract":"{}","token_id":"{}","seller":"{}","buyer":"{}","price":"{}","fee":"{}"}}]}}"#,
            listing.nft_contract,
            listing.token_id,
            listing.seller,
            buyer,
            listing.price.0,
            fee
        );
        U128(amount.0 - listing.price.0)
    }

    #[private]
    pub fn on_paid(&mut self, seller: AccountId, amount: U128, #[callback_result] r: Result<(), PromiseError>) -> bool {
        if r.is_err() {
            let o = self.owed.get(&seller).copied().unwrap_or(0);
            self.owed.insert(seller, o + amount.0);
            return false;
        }
        true
    }

    /// After the house's cut: what it refused (or a failed transfer) is owed to it.
    #[private]
    pub fn on_fee_paid(&mut self, house: AccountId, amount: U128, #[callback_result] used: Result<U128, PromiseError>) {
        let back = amount.0 - used.map_or(0, |u| u.0.min(amount.0));
        if back > 0 {
            let o = self.owed.get(&house).copied().unwrap_or(0);
            self.owed.insert(house, o + back);
        }
    }

    /// A seller collects USDC whose payout failed.
    pub fn withdraw_owed(&mut self) {
        let seller = env::predecessor_account_id();
        let amount = self.owed.remove(&seller).unwrap_or(0);
        require!(amount > 0, "Nothing owed");
        self.pay(seller, amount);
    }

    // Views

    pub fn get_listing(&self, nft_contract: AccountId, token_id: TokenId) -> Option<Listing> {
        self.listings.get(&(nft_contract, token_id)).cloned()
    }

    pub fn get_listings(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Listing> {
        self.listings
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(MAX_LISTINGS_PAGE).min(MAX_LISTINGS_PAGE) as usize)
            .cloned()
            .collect()
    }

    pub fn get_owed(&self, account_id: AccountId) -> U128 {
        U128(self.owed.get(&account_id).copied().unwrap_or(0))
    }
}

/// Listing: the NFT contract tells the market it was approved, with the price in `msg`.
#[near]
impl NonFungibleTokenApprovalReceiver for Market {
    fn nft_on_approve(&mut self, token_id: TokenId, owner_id: AccountId, approval_id: u64, msg: String) -> PromiseOrValue<String> {
        let nft_contract = env::predecessor_account_id();
        require!(self.nft_contracts.contains(&nft_contract), "Only Life NFTs and $1UP locks can be listed");
        let ListMsg { price } = near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Bad message"));
        require!(price.0 > 0, "Set a price");
        let listing = Listing {
            nft_contract: nft_contract.clone(),
            token_id: token_id.clone(),
            seller: owner_id,
            approval_id,
            price,
            listed_at: env::block_timestamp() / 1_000_000_000,
        };
        self.listings.insert((nft_contract, token_id), listing);
        PromiseOrValue::Value("listed".into())
    }
}

impl Market {
    /// The house's cut, as a `market_fee` deposit into its pool. If it fails it's owed to the house like a
    /// failed seller payout, collectable with `collect`.
    fn pay_house(&self, amount: u128) {
        let house = self.house.clone().expect("house");
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER.saturating_mul(3))
            .ft_transfer_call(house.clone(), U128(amount), None, r#"{"market_fee":{}}"#.into())
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_PAID).on_fee_paid(house, U128(amount)))
            .detach();
    }

    fn pay(&self, seller: AccountId, amount: u128) {
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(seller.clone(), U128(amount), None)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_PAID).on_paid(seller, U128(amount)))
            .detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(predecessor: &str) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(acc(predecessor)).build());
    }

    fn setup() -> Market {
        ctx("owner");
        near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
        Market::new(acc("usdc"), vec![acc("life"), acc("ve")], None, None)
    }

    fn list(m: &mut Market, nft: &str, token: &str, seller: &str, price: u128) {
        list_as(m, nft, token, seller, price, 7);
    }

    /// Each `nft_approve` gets a new approval id from the NFT contract.
    fn list_as(m: &mut Market, nft: &str, token: &str, seller: &str, price: u128, approval_id: u64) {
        ctx(nft);
        let _ = m.nft_on_approve(token.into(), acc(seller), approval_id, format!(r#"{{"price":"{price}"}}"#));
    }

    fn buy(m: &mut Market, buyer: &str, nft: &str, token: &str, amount: u128, price: u128) {
        buy_seen(m, buyer, nft, token, amount, price, 7);
    }

    /// Buys the listing the buyer saw: its price and approval id.
    fn buy_seen(m: &mut Market, buyer: &str, nft: &str, token: &str, amount: u128, price: u128, approval_id: u64) {
        ctx("usdc");
        let _ = m.ft_on_transfer(
            acc(buyer),
            U128(amount),
            format!(r#"{{"buy":{{"nft_contract":"{nft}","token_id":"{token}","price":"{price}","approval_id":{approval_id}}}}}"#),
        );
    }

    #[test]
    fn list_and_view() {
        let mut m = setup();
        list(&mut m, "life", "3:alice", "alice", 90_000_000);
        let l = m.get_listing(acc("life"), "3:alice".into()).unwrap();
        assert_eq!((l.seller.as_str(), l.approval_id, l.price.0), ("alice", 7, 90_000_000));
        // listing again replaces the price
        list(&mut m, "life", "3:alice", "alice", 80_000_000);
        assert_eq!(m.get_listings(None, None).len(), 1);
        assert_eq!(m.get_listings(None, None)[0].price.0, 80_000_000);
    }

    #[test]
    #[should_panic(expected = "Only Life NFTs and $1UP locks")]
    fn other_nfts_are_refused() {
        let mut m = setup();
        list(&mut m, "punks", "1", "alice", 1);
    }

    #[test]
    fn buying_takes_the_listing_down_and_pays_on_success() {
        let mut m = setup();
        list(&mut m, "ve", "12", "alice", 50_000_000);
        buy(&mut m, "bob", "ve", "12", 60_000_000, 50_000_000);
        assert!(m.get_listing(acc("ve"), "12".into()).is_none());
        // the NFT moved: Bob gets 10 USDC change
        let l = Listing { nft_contract: acc("ve"), token_id: "12".into(), seller: acc("alice"), approval_id: 7, price: U128(50_000_000), listed_at: 0 };
        ctx("market");
        assert_eq!(m.on_bought(l.clone(), acc("bob"), U128(60_000_000), Ok(())).0, 10_000_000);
        // it didn't: everything back
        assert_eq!(m.on_bought(l, acc("bob"), U128(60_000_000), Err(PromiseError::Failed)).0, 60_000_000);
    }

    #[test]
    #[should_panic(expected = "Below the price")]
    fn underpaying_fails() {
        let mut m = setup();
        list(&mut m, "ve", "12", "alice", 50_000_000);
        buy(&mut m, "bob", "ve", "12", 49_999_999, 50_000_000);
    }

    #[test]
    #[should_panic(expected = "Price changed")]
    fn a_reprice_under_the_buyer_fails() {
        let mut m = setup();
        list(&mut m, "ve", "12", "alice", 50_000_000);
        // Bob sends 60 for the 50 listing; Alice re-lists at 60 first
        list(&mut m, "ve", "12", "alice", 60_000_000);
        buy(&mut m, "bob", "ve", "12", 60_000_000, 50_000_000);
    }

    #[test]
    #[should_panic(expected = "Price changed")]
    fn a_cut_price_must_be_seen_too() {
        let mut m = setup();
        list(&mut m, "ve", "12", "alice", 50_000_000);
        buy(&mut m, "bob", "ve", "12", 50_000_000, 40_000_000);
    }

    #[test]
    #[should_panic(expected = "Listing changed")]
    fn a_relist_at_the_same_price_under_the_buyer_fails() {
        let mut m = setup();
        list_as(&mut m, "life", "3:alice", "alice", 50_000_000, 7);
        // Bob sends 50 for the listing he saw; Alice claims the Life's USDC (which drops its approvals) and lists
        // it again at 50 first: same price, new approval
        list_as(&mut m, "life", "3:alice", "alice", 50_000_000, 8);
        buy_seen(&mut m, "bob", "life", "3:alice", 50_000_000, 50_000_000, 7);
    }

    #[test]
    fn the_listing_seen_can_be_bought() {
        let mut m = setup();
        list_as(&mut m, "life", "3:alice", "alice", 50_000_000, 7);
        list_as(&mut m, "life", "3:alice", "alice", 50_000_000, 8);
        buy_seen(&mut m, "bob", "life", "3:alice", 50_000_000, 50_000_000, 8);
        assert!(m.get_listing(acc("life"), "3:alice".into()).is_none());
    }

    #[test]
    #[should_panic(expected = "Bad message")]
    fn buy_needs_the_approval_id() {
        let mut m = setup();
        list(&mut m, "ve", "12", "alice", 50_000_000);
        ctx("usdc");
        let _ = m.ft_on_transfer(acc("bob"), U128(50_000_000), r#"{"buy":{"nft_contract":"ve","token_id":"12","price":"50000000"}}"#.into());
    }

    #[test]
    #[should_panic(expected = "Bad message")]
    fn buy_needs_a_price() {
        let mut m = setup();
        list(&mut m, "ve", "12", "alice", 50_000_000);
        ctx("usdc");
        let _ = m.ft_on_transfer(acc("bob"), U128(50_000_000), r#"{"buy":{"nft_contract":"ve","token_id":"12","approval_id":7}}"#.into());
    }

    #[test]
    #[should_panic(expected = "Pay in USDC")]
    fn only_usdc_buys() {
        let mut m = setup();
        list(&mut m, "ve", "12", "alice", 50_000_000);
        ctx("oneup");
        let _ = m.ft_on_transfer(acc("bob"), U128(50_000_000), r#"{"buy":{"nft_contract":"ve","token_id":"12","price":"50000000","approval_id":7}}"#.into());
    }

    #[test]
    #[should_panic(expected = "Not your listing")]
    fn only_the_seller_delists() {
        let mut m = setup();
        list(&mut m, "ve", "12", "alice", 50_000_000);
        ctx("bob");
        m.delist(acc("ve"), "12".into());
    }

    #[test]
    fn failed_payout_is_owed() {
        let mut m = setup();
        ctx("market");
        m.on_paid(acc("alice"), U128(5), Err(PromiseError::Failed));
        assert_eq!(m.get_owed(acc("alice")).0, 5);
    }

    #[test]
    fn the_house_takes_its_cut() {
        ctx("market");
        let mut m = Market::new(acc("usdc"), vec![acc("life"), acc("ve")], Some(acc("house")), Some(U128(20_000)));
        let l = Listing { nft_contract: acc("ve"), token_id: "12".into(), seller: acc("alice"), approval_id: 7, price: U128(50_000_000), listed_at: 0 };
        // the buyer still pays the price and gets the change; 2% (1 USDC) goes to the house
        assert_eq!(m.on_bought(l, acc("bob"), U128(60_000_000), Ok(())).0, 10_000_000);
        let logs = near_sdk::test_utils::get_logs();
        assert!(logs.iter().any(|l| l.contains(r#""price":"50000000","fee":"1000000""#)), "{logs:?}");
    }

    #[test]
    #[should_panic(expected = "Fee above 10%")]
    fn the_fee_is_capped() {
        ctx("market");
        Market::new(acc("usdc"), vec![], Some(acc("house")), Some(U128(100_001)));
    }
}
