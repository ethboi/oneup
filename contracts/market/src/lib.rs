//! Marketplace for Extra Lives and $1UP locks (D-17).
//!
//! List: `nft_approve(token_id, market, msg = {"price":"<USDC>"})` on the NFT contract; it calls
//! `nft_on_approve` here. Buy: one USDC `ft_transfer_call` to the market with
//! `{"buy":{"nft_contract":…,"token_id":…,"price":"<USDC>"}}`; `price` must match the listing, so a
//! seller can't re-price it under a buyer who sent more. The NFT moves straight from seller to buyer through the
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

const GAS_NFT_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_ON_BOUGHT: Gas = Gas::from_tgas(25);
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
    /// `price`: the listing price the buyer saw.
    Buy { nft_contract: AccountId, token_id: TokenId, price: U128 },
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
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Market {
    usdc: AccountId,
    /// NFT contracts that can be listed: the Extra Life and ve contracts.
    nft_contracts: Vec<AccountId>,
    listings: IterableMap<(AccountId, TokenId), Listing>,
    /// USDC owed to sellers after a failed payout.
    owed: LookupMap<AccountId, u128>,
}

#[near]
impl Market {
    #[init]
    pub fn new(usdc: AccountId, nft_contracts: Vec<AccountId>) -> Self {
        Self { usdc, nft_contracts, listings: IterableMap::new(StorageKey::Listings), owed: LookupMap::new(StorageKey::Owed) }
    }

    /// Seller only: takes a listing down. (The approval stays on the NFT until revoked, but nothing can be
    /// bought without a listing.)
    pub fn delist(&mut self, nft_contract: AccountId, token_id: TokenId) {
        let key = (nft_contract, token_id);
        let l = self.listings.get(&key).unwrap_or_else(|| env::panic_str("Not listed"));
        require!(l.seller == env::predecessor_account_id(), "Not your listing");
        self.listings.remove(&key);
    }

    /// Buys with USDC: `{"buy":{"nft_contract","token_id","price"}}`. Fails (refunding all) unless `price`
    /// is the listing's price; anything sent above it is refunded.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "Pay in USDC");
        let BuyMsg::Buy { nft_contract, token_id, price } =
            near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Bad message"));
        let key = (nft_contract.clone(), token_id.clone());
        let l = self.listings.get(&key).cloned().unwrap_or_else(|| env::panic_str("Not listed"));
        require!(price.0 == l.price.0, "Price changed");
        require!(amount.0 >= l.price.0, "Below the price");
        require!(sender_id != l.seller, "That's your own listing");
        // taken down now so it can't be bought twice while the transfer is in flight
        self.listings.remove(&key);
        ext_nft::ext(nft_contract)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_NFT_TRANSFER)
            .nft_transfer(sender_id.clone(), token_id, Some(l.approval_id), Some("OneUp market".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_BOUGHT).on_bought(l, sender_id, amount))
            .into()
    }

    /// Returns the USDC the buyer gets back: the change if the NFT moved, everything if it didn't.
    #[private]
    pub fn on_bought(&mut self, listing: Listing, buyer: AccountId, amount: U128, #[callback_result] moved: Result<(), PromiseError>) -> U128 {
        if moved.is_err() {
            env::log_str(&format!("{} #{} couldn't move; refunding {}", listing.nft_contract, listing.token_id, buyer));
            return amount;
        }
        self.pay(listing.seller.clone(), listing.price.0);
        near_sdk::log!(
            r#"EVENT_JSON:{{"standard":"oneup_market","version":"1.0.0","event":"sold","data":[{{"nft_contract":"{}","token_id":"{}","seller":"{}","buyer":"{}","price":"{}"}}]}}"#,
            listing.nft_contract,
            listing.token_id,
            listing.seller,
            buyer,
            listing.price.0
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
        require!(self.nft_contracts.contains(&nft_contract), "Only Extra Lives and $1UP locks can be listed");
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
        Market::new(acc("usdc"), vec![acc("life"), acc("ve")])
    }

    fn list(m: &mut Market, nft: &str, token: &str, seller: &str, price: u128) {
        ctx(nft);
        let _ = m.nft_on_approve(token.into(), acc(seller), 7, format!(r#"{{"price":"{price}"}}"#));
    }

    fn buy(m: &mut Market, buyer: &str, nft: &str, token: &str, amount: u128, price: u128) {
        ctx("usdc");
        let _ = m.ft_on_transfer(acc(buyer), U128(amount), format!(r#"{{"buy":{{"nft_contract":"{nft}","token_id":"{token}","price":"{price}"}}}}"#));
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
    #[should_panic(expected = "Only Extra Lives and $1UP locks")]
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
    #[should_panic(expected = "Bad message")]
    fn buy_needs_a_price() {
        let mut m = setup();
        list(&mut m, "ve", "12", "alice", 50_000_000);
        ctx("usdc");
        let _ = m.ft_on_transfer(acc("bob"), U128(50_000_000), r#"{"buy":{"nft_contract":"ve","token_id":"12"}}"#.into());
    }

    #[test]
    #[should_panic(expected = "Pay in USDC")]
    fn only_usdc_buys() {
        let mut m = setup();
        list(&mut m, "ve", "12", "alice", 50_000_000);
        ctx("oneup");
        let _ = m.ft_on_transfer(acc("bob"), U128(50_000_000), r#"{"buy":{"nft_contract":"ve","token_id":"12","price":"50000000"}}"#.into());
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
}
