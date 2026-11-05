//! Mock USDC for testnet demos (decision D-8): NEP-141, 6 decimals, with a rate-limited faucet.

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
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

const FAUCET_MAX: u128 = 10_000 * 1_000_000;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockUsdc {
    owner: AccountId,
    token: FungibleToken,
}

#[near]
impl MockUsdc {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        let mut token = FungibleToken::new(b"t");
        token.internal_register_account(&owner);
        Self { owner, token }
    }

    /// Anyone: up to 10K per call, registering the receiver if needed.
    pub fn faucet(&mut self, receiver_id: Option<AccountId>, amount: U128) {
        require!(amount.0 <= FAUCET_MAX, "Faucet max is 10,000 USDC per call");
        self.mint_to(receiver_id.unwrap_or_else(env::predecessor_account_id), amount.0);
    }

    /// Owner: any amount (pool seed, bots).
    pub fn mint(&mut self, receiver_id: AccountId, amount: U128) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        self.mint_to(receiver_id, amount.0);
    }

    fn mint_to(&mut self, account: AccountId, amount: u128) {
        if !self.token.accounts.contains_key(&account) {
            self.token.internal_register_account(&account);
        }
        self.token.internal_deposit(&account, amount);
    }
}

#[near]
impl FungibleTokenCore for MockUsdc {
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
impl FungibleTokenResolver for MockUsdc {
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
impl StorageManagement for MockUsdc {
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
    /// The faucet registers accounts for free, so accounts stay registered: unregistering would refund a deposit
    /// nobody paid, and repeating it would drain this contract's NEAR.
    fn storage_unregister(&mut self, _force: Option<bool>) -> bool {
        env::panic_str("Accounts stay registered on this test token")
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for MockUsdc {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "OneUp Test USDC".to_string(),
            symbol: "USDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}
