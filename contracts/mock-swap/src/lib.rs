//! A minimal USDC → $1UP constant-product pool for testnet buybacks (decision D-9), standing in for Rhea.
//! Liquidity comes from the owner; swaps pay out with `ft_transfer_call` so the receiver learns the amount.

use near_sdk::json_types::U128;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, PromiseOrValue};

const GAS_PAYOUT: Gas = Gas::from_tgas(100);
const FEE_PPM: u128 = 3_000;

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
enum SwapMsg {
    /// Owner only: add the transferred tokens to the reserves.
    AddLiquidity {},
    /// USDC in → $1UP out to `receiver_id` via `ft_transfer_call` with `msg`.
    Swap { min_out: U128, receiver_id: AccountId, msg: String },
}

#[allow(dead_code)]
#[ext_contract(ext_ft)]
trait FungibleToken {
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> U128;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockSwap {
    owner: AccountId,
    usdc: AccountId,
    oneup: AccountId,
    usdc_reserve: u128,
    oneup_reserve: u128,
}

#[near]
impl MockSwap {
    #[init]
    pub fn new(owner: AccountId, usdc: AccountId, oneup: AccountId) -> Self {
        Self { owner, usdc, oneup, usdc_reserve: 0, oneup_reserve: 0 }
    }

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        require!(token == self.usdc || token == self.oneup, "Unknown token");
        let msg: SwapMsg = near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Bad message"));
        match msg {
            SwapMsg::AddLiquidity {} => {
                require!(sender_id == self.owner, "Only the owner adds liquidity");
                if token == self.usdc {
                    self.usdc_reserve += amount.0;
                } else {
                    self.oneup_reserve += amount.0;
                }
                PromiseOrValue::Value(U128(0))
            }
            SwapMsg::Swap { min_out, receiver_id, msg } => {
                require!(token == self.usdc, "Only USDC → $1UP");
                let out = self.quote(amount.0);
                require!(out > 0 && out >= min_out.0, "Not enough output");
                self.usdc_reserve += amount.0;
                self.oneup_reserve -= out;
                ext_ft::ext(self.oneup.clone())
                    .with_attached_deposit(NearToken::from_yoctonear(1))
                    .with_static_gas(GAS_PAYOUT)
                    .ft_transfer_call(receiver_id, U128(out), None, msg)
                    .detach();
                PromiseOrValue::Value(U128(0))
            }
        }
    }

    /// $1UP out for `usdc_in`, after a 0.3% fee.
    pub fn get_quote(&self, usdc_in: U128) -> U128 {
        U128(self.quote(usdc_in.0))
    }

    pub fn get_reserves(&self) -> (U128, U128) {
        (U128(self.usdc_reserve), U128(self.oneup_reserve))
    }
}

impl MockSwap {
    fn quote(&self, usdc_in: u128) -> u128 {
        if self.usdc_reserve == 0 || self.oneup_reserve == 0 {
            return 0;
        }
        let x = usdc_in * (1_000_000 - FEE_PPM) / 1_000_000;
        // x·y = k: out = y·x / (X + x). $1UP has 18 decimals, so y·x stays well inside u128 for testnet sizes.
        self.oneup_reserve / (self.usdc_reserve + x) * x
            + self.oneup_reserve % (self.usdc_reserve + x) * x / (self.usdc_reserve + x)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    #[test]
    fn constant_product_quote() {
        testing_env!(VMContextBuilder::new().predecessor_account_id("usdc".parse().unwrap()).build());
        let mut s = MockSwap::new("owner".parse().unwrap(), "usdc".parse().unwrap(), "oneup".parse().unwrap());
        let _ = s.ft_on_transfer("owner".parse().unwrap(), U128(100_000 * 1_000_000), r#"{"add_liquidity":{}}"#.into());
        testing_env!(VMContextBuilder::new().predecessor_account_id("oneup".parse().unwrap()).build());
        let one = 1_000_000_000_000_000_000u128;
        let _ = s.ft_on_transfer("owner".parse().unwrap(), U128(10_000_000 * one), r#"{"add_liquidity":{}}"#.into());
        // 1_000 USDC into a 100K / 10M pool: 10M × 997 / 100_997 ≈ 98_715.8 $1UP
        let out = s.get_quote(U128(1_000 * 1_000_000)).0;
        assert_eq!(out / one, 98_715);
    }
}
