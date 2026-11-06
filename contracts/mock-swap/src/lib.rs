//! A minimal USDC → $1UP constant-product pool for testnet buybacks (decision D-9), standing in for Rhea.
//! Liquidity comes from the owner; swaps pay out with `ft_transfer_call` so the receiver learns the amount.

use near_sdk::json_types::U128;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, PromiseOrValue};

const GAS_PAYOUT: Gas = Gas::from_tgas(100);
const GAS_SWAPPED: Gas = Gas::from_tgas(5);
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
                PromiseOrValue::Promise(
                    ext_ft::ext(self.oneup.clone())
                        .with_attached_deposit(NearToken::from_yoctonear(1))
                        .with_static_gas(GAS_PAYOUT)
                        .ft_transfer_call(receiver_id, U128(out), None, msg)
                        .then(Self::ext(env::current_account_id()).with_static_gas(GAS_SWAPPED).on_swapped(amount, U128(out))),
                )
            }
        }
    }

    /// How much of the USDC to give back, by what the receiver kept of the output: nothing delivered undoes the
    /// swap and refunds the USDC, and a part delivered returns only the rest of the $1UP to the reserve.
    #[private]
    pub fn on_swapped(&mut self, usdc_in: U128, out: U128, #[callback_result] used: Result<U128, near_sdk::PromiseError>) -> U128 {
        let delivered = used.map_or(0, |u| u.0.min(out.0));
        self.oneup_reserve += out.0 - delivered;
        if delivered > 0 {
            return U128(0);
        }
        self.usdc_reserve -= usdc_in.0;
        usdc_in
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

    fn callback(result: near_sdk::PromiseResult) {
        testing_env!(
            VMContextBuilder::new().predecessor_account_id(env::current_account_id()).current_account_id(env::current_account_id()).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![result],
        );
    }

    fn pool() -> MockSwap {
        testing_env!(VMContextBuilder::new().predecessor_account_id("usdc".parse().unwrap()).build());
        let mut s = MockSwap::new("owner".parse().unwrap(), "usdc".parse().unwrap(), "oneup".parse().unwrap());
        s.usdc_reserve = 1_000;
        s.oneup_reserve = 5_000;
        s
    }

    #[test]
    fn nothing_delivered_undoes_the_swap_and_refunds_the_usdc() {
        let mut s = pool();
        callback(near_sdk::PromiseResult::Failed);
        assert_eq!(s.on_swapped(U128(100), U128(400), Err(near_sdk::PromiseError::Failed)).0, 100);
        assert_eq!((s.usdc_reserve, s.oneup_reserve), (900, 5_400));
    }

    #[test]
    fn a_full_delivery_keeps_the_swap() {
        let mut s = pool();
        callback(near_sdk::PromiseResult::Successful(b"\"400\"".to_vec()));
        assert_eq!(s.on_swapped(U128(100), U128(400), Ok(U128(400))).0, 0);
        assert_eq!((s.usdc_reserve, s.oneup_reserve), (1_000, 5_000));
    }

    #[test]
    fn a_part_delivery_returns_only_the_rest_of_the_output() {
        let mut s = pool();
        callback(near_sdk::PromiseResult::Successful(b"\"150\"".to_vec()));
        assert_eq!(s.on_swapped(U128(100), U128(400), Ok(U128(150))).0, 0);
        assert_eq!((s.usdc_reserve, s.oneup_reserve), (1_000, 5_250));
    }
}
