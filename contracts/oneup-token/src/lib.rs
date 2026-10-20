//! $1UP (NEP-141): 1B fixed supply, minted once at `new`, no mint function after.
//! 900M to the house (paid out as emissions over 208 epochs), 50M to seed the Rhea pool, 50M treasury.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{near, AccountId, NearToken, PanicOnDefault, PromiseOrValue};
use oneup_math as math;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct OneUpToken {
    token: FungibleToken,
}

#[near]
impl OneUpToken {
    #[init]
    pub fn new(house: AccountId, rhea_seed: AccountId, treasury: AccountId) -> Self {
        let mut token = FungibleToken::new(b"t");
        let rest = (math::SUPPLY - math::EMISSIONS_TOTAL) / 2;
        for (account, amount) in [(house, math::EMISSIONS_TOTAL), (rhea_seed, rest), (treasury, rest)] {
            if !token.accounts.contains_key(&account) {
                token.internal_register_account(&account);
            }
            token.internal_deposit(&account, amount);
            FtMint { owner_id: &account, amount: U128(amount), memo: Some("genesis") }.emit();
        }
        Self { token }
    }
}

#[near]
impl FungibleTokenCore for OneUpToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for OneUpToken {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for OneUpToken {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for OneUpToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "OneUp".to_string(),
            symbol: "1UP".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 18,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    #[test]
    fn fixed_supply() {
        testing_env!(VMContextBuilder::new().build());
        let t = OneUpToken::new("house".parse().unwrap(), "rhea".parse().unwrap(), "treasury".parse().unwrap());
        assert_eq!(t.ft_total_supply().0, math::SUPPLY);
        assert_eq!(t.ft_balance_of("house".parse().unwrap()).0, 900_000_000 * math::ONEUP);
        assert_eq!(t.ft_balance_of("rhea".parse().unwrap()).0, 50_000_000 * math::ONEUP);
        assert_eq!(t.ft_balance_of("treasury".parse().unwrap()).0, 50_000_000 * math::ONEUP);
    }

    #[test]
    fn same_account_for_seed_and_treasury() {
        testing_env!(VMContextBuilder::new().build());
        let t = OneUpToken::new("house".parse().unwrap(), "dao".parse().unwrap(), "dao".parse().unwrap());
        assert_eq!(t.ft_balance_of("dao".parse().unwrap()).0, 100_000_000 * math::ONEUP);
    }
}
