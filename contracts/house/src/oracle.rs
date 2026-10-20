use near_sdk::json_types::U128;
use near_sdk::{ext_contract, near, AccountId};
use oneup_math as math;

/// Pyth-compatible price as returned by Outlayer `price-oracle-pyth.*` and `mock-oracle`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct OraclePrice {
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
}

#[allow(dead_code)]
#[ext_contract(ext_oracle)]
pub trait Oracle {
    fn get_price_unsafe(&self, price_identifier: String) -> Option<OraclePrice>;
}

#[allow(dead_code)]
#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

/// A price that passed the age and confidence checks, in 1e8 units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CheckedPrice {
    pub price: u128,
    pub publish_time: u64,
}

impl OraclePrice {
    /// Maths §2: not older than `max_age_s` at `now_s`, and `conf / price ≤ max_conf_ppm`.
    pub fn check(&self, now_s: u64, max_age_s: u64, max_conf_ppm: u128) -> Result<CheckedPrice, &'static str> {
        let price = math::normalize_price(self.price, self.expo).ok_or("Bad oracle price")?;
        if self.publish_time < 0 || self.publish_time as u64 > now_s + 5 {
            return Err("Oracle price from the future");
        }
        let publish_time = self.publish_time as u64;
        if now_s.saturating_sub(publish_time) > max_age_s {
            return Err("Oracle price is stale");
        }
        // conf shares the price's exponent, so compare the raw values
        if (self.conf as u128) * math::PPM > (self.price as u128) * max_conf_ppm {
            return Err("Oracle confidence too wide");
        }
        Ok(CheckedPrice { price, publish_time })
    }
}
