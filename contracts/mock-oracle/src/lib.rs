//! Pyth-compatible price oracle for testnet (decision D-6). Same view calls and JSON shape as Outlayer's
//! `price-oracle-pyth.*`, so the house can point at either. The keeper pushes prices from Pyth Hermes.

use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

const STALE_THRESHOLD_S: u64 = 60;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Price {
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
}

#[near(serializers = [json])]
pub struct PriceUpdate {
    pub feed_id: String,
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Oracle {
    owner: AccountId,
    pusher: AccountId,
    prices: LookupMap<String, Price>,
}

#[near]
impl Oracle {
    #[init]
    pub fn new(owner: AccountId, pusher: AccountId) -> Self {
        Self { owner, pusher, prices: LookupMap::new(b"p") }
    }

    /// Pusher only. Updates that aren't newer than the stored price are skipped, not rejected,
    /// so one slow feed doesn't fail the whole batch.
    pub fn push_prices(&mut self, updates: Vec<PriceUpdate>) -> u32 {
        require!(env::predecessor_account_id() == self.pusher, "Only the pusher");
        let mut applied = 0;
        for u in updates {
            if self.prices.get(&u.feed_id).is_some_and(|p| u.publish_time <= p.publish_time) {
                continue;
            }
            self.prices.insert(
                u.feed_id,
                Price { price: u.price, conf: u.conf, expo: u.expo, publish_time: u.publish_time },
            );
            applied += 1;
        }
        applied
    }

    pub fn set_pusher(&mut self, pusher: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        self.pusher = pusher;
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_price_unsafe(&self, price_identifier: String) -> Option<Price> {
        self.prices.get(&price_identifier).cloned()
    }

    pub fn get_price(&self, price_identifier: String) -> Option<Price> {
        self.get_price_no_older_than(price_identifier, STALE_THRESHOLD_S)
    }

    pub fn get_price_no_older_than(&self, price_id: String, age: u64) -> Option<Price> {
        let now = (env::block_timestamp() / 1_000_000_000) as i64;
        self.prices.get(&price_id).filter(|p| now - p.publish_time <= age as i64).cloned()
    }

    pub fn price_feed_exists(&self, price_identifier: String) -> bool {
        self.prices.contains_key(&price_identifier)
    }

    pub fn get_stale_threshold(&self) -> u64 {
        STALE_THRESHOLD_S
    }
}
