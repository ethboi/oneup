//! A stand-in for a USDC lending market (Aave or a Morpho vault on Ethereum, reached through NEAR Intents and a
//! Chain Signatures account on mainnet, D-27). Depositors' USDC earns a fixed APR, accrued every second;
//! principal and interest can be withdrawn at any time. The interest is minted from mock USDC's faucet, so on
//! localnet it costs nobody anything.

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};

const GAS_FT: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(5);
const GAS_REPORT: Gas = Gas::from_tgas(2);
/// The mock USDC faucet's limit per call.
const FAUCET_MAX: u128 = 10_000 * 1_000_000;
const PPM: u128 = 1_000_000;

#[allow(dead_code)]
#[ext_contract(ext_usdc)]
trait Usdc {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn faucet(&mut self, receiver_id: Option<AccountId>, amount: U128);
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default, Debug)]
pub struct Deposit {
    pub principal: U128,
    /// Accrued and not yet withdrawn.
    pub interest: U128,
    pub updated: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockVault {
    usdc: AccountId,
    apr_ppm: u128,
    /// Seconds in the vault's year: a real year on mainnet, 52 demo epochs on localnet so the APR shows.
    year_s: u64,
    deposits: LookupMap<AccountId, Deposit>,
}

#[near]
impl MockVault {
    #[init]
    pub fn new(usdc: AccountId, apr_ppm: U128, year_s: u64) -> Self {
        Self { usdc, apr_ppm: apr_ppm.0, year_s, deposits: LookupMap::new(b"d") }
    }

    /// USDC in: a deposit for the sender.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "Only USDC");
        let _ = msg;
        let mut d = self.settled(&sender_id);
        d.principal.0 += amount.0;
        self.deposits.insert(sender_id, d);
        PromiseOrValue::Value(U128(0))
    }

    /// Sends `amount` of the caller's principal back.
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let who = env::predecessor_account_id();
        let mut d = self.settled(&who);
        require!(amount.0 > 0 && amount.0 <= d.principal.0, "More than deposited");
        d.principal.0 -= amount.0;
        self.deposits.insert(who.clone(), d);
        ext_usdc::ext(self.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT)
            .ft_transfer(who.clone(), amount, None)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK.saturating_add(GAS_REPORT)).on_withdrawn(who, amount))
    }

    /// A failed transfer gives the principal back. The caller still has to see the failure, and a panic here would
    /// undo the restoring, so that comes from a promise of its own.
    #[private]
    pub fn on_withdrawn(&mut self, who: AccountId, amount: U128, #[callback_result] r: Result<(), near_sdk::PromiseError>) -> PromiseOrValue<()> {
        if r.is_ok() {
            return PromiseOrValue::Value(());
        }
        let mut d = self.settled(&who);
        d.principal.0 += amount.0;
        self.deposits.insert(who, d);
        PromiseOrValue::Promise(Self::ext(env::current_account_id()).with_static_gas(GAS_REPORT).withdrawal_failed())
    }

    #[private]
    pub fn withdrawal_failed(&self) {
        env::panic_str("Withdrawal failed; the principal is still deposited");
    }

    /// Sends the caller's accrued interest (up to the faucet's 10,000 per call; the rest stays accrued) and
    /// returns how much.
    pub fn withdraw_interest(&mut self) -> PromiseOrValue<U128> {
        let who = env::predecessor_account_id();
        let mut d = self.settled(&who);
        let amount = d.interest.0.min(FAUCET_MAX);
        if amount == 0 {
            return PromiseOrValue::Value(U128(0));
        }
        d.interest.0 -= amount;
        self.deposits.insert(who.clone(), d);
        // mint the interest to the vault, then pass it on
        let usdc = self.usdc.clone();
        PromiseOrValue::Promise(
            ext_usdc::ext(usdc.clone())
                .with_static_gas(GAS_FT)
                .faucet(None, U128(amount))
                .then(ext_usdc::ext(usdc).with_attached_deposit(NearToken::from_yoctonear(1)).with_static_gas(GAS_FT).ft_transfer(who.clone(), U128(amount), None))
                .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).sent(who, U128(amount))),
        )
    }

    #[private]
    pub fn sent(&mut self, who: AccountId, amount: U128, #[callback_result] r: Result<(), near_sdk::PromiseError>) -> U128 {
        if r.is_ok() {
            return amount;
        }
        // not delivered: it stays accrued
        let mut d = self.settled(&who);
        d.interest.0 += amount.0;
        self.deposits.insert(who, d);
        U128(0)
    }

    /// A depositor's principal and interest accrued to now.
    pub fn deposit_of(&self, account_id: AccountId) -> Deposit {
        self.accrued(self.deposits.get(&account_id).cloned().unwrap_or_default())
    }

    pub fn apr_ppm(&self) -> U128 {
        U128(self.apr_ppm)
    }
}

impl MockVault {
    fn accrued(&self, mut d: Deposit) -> Deposit {
        let now = env::block_timestamp() / 1_000_000_000;
        if d.updated > 0 && now > d.updated {
            d.interest.0 += d.principal.0 * self.apr_ppm * (now - d.updated) as u128 / (PPM * self.year_s as u128);
        }
        d.updated = now;
        d
    }

    fn settled(&mut self, who: &AccountId) -> Deposit {
        self.accrued(self.deposits.get(who).cloned().unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(who: &str, t: u64) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(who.parse().unwrap()).block_timestamp(t * 1_000_000_000).build());
    }

    #[test]
    fn interest_accrues_at_the_apr() {
        ctx("usdc", 1_000);
        let mut v = MockVault::new("usdc".parse().unwrap(), U128(50_000), 1_000_000);
        let _ = v.ft_on_transfer("house".parse().unwrap(), U128(1_000_000_000), String::new());
        ctx("usdc", 1_000 + 500_000); // half a year at 5%: 2.5% of 1,000
        let d = v.deposit_of("house".parse().unwrap());
        assert_eq!((d.principal.0, d.interest.0), (1_000_000_000, 25_000_000));
    }

    #[test]
    #[should_panic(expected = "More than deposited")]
    fn cant_take_more_than_deposited() {
        ctx("usdc", 1);
        let mut v = MockVault::new("usdc".parse().unwrap(), U128(50_000), 1_000);
        let _ = v.ft_on_transfer("house".parse().unwrap(), U128(100), String::new());
        ctx("house", 2);
        let _ = v.withdraw(U128(101));
    }
}
