//! Extra Life NFTs (NEP-171 + metadata + enumeration + approvals): capped USDC claims on house profit.
//! The house mints one per losing wallet per epoch and sends each epoch's pot here; holders claim.
//! Unclaimed USDC moves with the token when it's sold.

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{NonFungibleTokenCore, NonFungibleTokenResolver};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};
use oneup_math as math;
use std::collections::HashMap;

mod acc;
pub use acc::{remaining_as_of, Accumulator, Snapshot};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_CLAIM_CALLBACK: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Life {
    pub epoch: u64,
    pub face: u128,
    pub cap_ppm: u128,
    pub owed: u128,
    pub at: Snapshot,
    pub claimed: u128,
}

#[near(serializers = [json])]
pub struct MintItem {
    pub owner: AccountId,
    pub face: U128,
    pub cap_ppm: U128,
}

#[near(serializers = [json])]
pub struct LifeInfo {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub epoch: u64,
    pub face: U128,
    pub cap_ppm: U128,
    pub owed: U128,
    /// Total earned so far, claimed or not.
    pub paid: U128,
    pub claimable: U128,
    /// Paid its cap: stops earning, stays as a badge.
    pub full_heal: bool,
    /// Past its earning window: keeps what it earned, earns no more.
    pub expired: bool,
}

/// Every life minted in one epoch shares a snapshot, so the group expires in one step.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Cohort {
    pub owed: u128,
    pub at: Snapshot,
    /// Snapshot when the group expired; its lives' balances are frozen there.
    pub expired_at: Option<Snapshot>,
}

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
enum PotMsg {
    EpochPot { epoch: u64 },
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    OwnerById,
    Metadata,
    Enumeration,
    Approval,
    Lives,
    Cohorts,
}

#[allow(dead_code)]
#[ext_contract(ext_ft)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ExtraLife {
    owner: AccountId,
    house: AccountId,
    usdc: AccountId,
    tokens: NonFungibleToken,
    lives: LookupMap<TokenId, Life>,
    acc: Accumulator,
    /// USDC received and not yet claimed. Claims never exceed it.
    held: u128,
    cohorts: LookupMap<u64, Cohort>,
    /// Next epoch whose lives may expire (the seed, epoch 0, never does).
    next_expiry: u64,
}

pub fn token_id(epoch: u64, owner: &AccountId) -> TokenId {
    format!("{epoch}:{owner}")
}

#[near]
impl ExtraLife {
    #[init]
    pub fn new(owner: AccountId, house: AccountId, usdc: AccountId) -> Self {
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::OwnerById,
                env::current_account_id(),
                Some(StorageKey::Metadata),
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approval),
            ),
            owner,
            house,
            usdc,
            lives: LookupMap::new(StorageKey::Lives),
            acc: Accumulator::default(),
            held: 0,
            cohorts: LookupMap::new(StorageKey::Cohorts),
            next_expiry: 1,
        }
    }

    /// House only. One life per (epoch, owner): `owed = face × cap`. Token id `"<epoch>:<owner>"`;
    /// epoch 0 is the seed. Storage is paid by this contract.
    pub fn mint_batch(&mut self, epoch: u64, items: Vec<MintItem>) -> Vec<TokenId> {
        require!(env::predecessor_account_id() == self.house, "Only the house");
        let mut ids = vec![];
        for item in items {
            let owed = math::owed(item.face.0, item.cap_ppm.0);
            if owed == 0 {
                continue;
            }
            let id = token_id(epoch, &item.owner);
            let at = self.acc.add(owed);
            match self.cohorts.get_mut(&epoch) {
                Some(c) => {
                    require!(c.at == at && c.expired_at.is_none(), "Epoch's lives already settled");
                    c.owed += owed;
                }
                None => {
                    require!(epoch == 0 || epoch >= self.next_expiry, "Epoch already expired");
                    self.cohorts.insert(epoch, Cohort { owed, at, expired_at: None });
                }
            }
            self.lives.insert(
                id.clone(),
                Life { epoch, face: item.face.0, cap_ppm: item.cap_ppm.0, owed, at, claimed: 0 },
            );
            let metadata = TokenMetadata {
                title: Some(format!("Extra Life · epoch {epoch}")),
                description: Some(format!(
                    "Earns up to {} USDC from OneUp house profit ({}× of {} face value).",
                    fmt_usdc(owed),
                    fmt_ppm(item.cap_ppm.0),
                    fmt_usdc(item.face.0)
                )),
                issued_at: Some(env::block_timestamp_ms().to_string()),
                ..Default::default()
            };
            self.tokens.internal_mint_with_refund(id.clone(), item.owner.clone(), Some(metadata), None);
            NftMint { owner_id: &item.owner, token_ids: &[&id], memo: None }.emit();
            ids.push(id);
        }
        ids
    }

    /// House only, before each epoch's pot: lives minted in `through_epoch` or earlier stop earning.
    /// Returns the total still owed to lives that are earning, which the house mirrors.
    pub fn expire(&mut self, through_epoch: u64) -> U128 {
        require!(env::predecessor_account_id() == self.house, "Only the house");
        while self.next_expiry <= through_epoch {
            let e = self.next_expiry;
            if let Some(mut c) = self.cohorts.get(&e).cloned() {
                let left = self.acc.expire(c.owed, c.at);
                c.expired_at = Some(self.acc.snapshot());
                self.cohorts.insert(e, c);
                env::log_str(&format!("epoch {e} lives expired with {left} unpaid"));
            }
            self.next_expiry += 1;
        }
        U128(self.acc.total_remaining)
    }

    /// USDC from the house: an epoch's pot, shared pro rata to what each life is still owed.
    /// Returns the unused part (when lives are owed less than the pot).
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "Only USDC");
        require!(sender_id == self.house, "Only the house sends pots");
        let PotMsg::EpochPot { epoch } =
            near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Bad pot message"));
        let used = self.acc.apply_pot(amount.0);
        self.held += used;
        env::log_str(&format!("epoch {epoch} pot {used} of {}", amount.0));
        PromiseOrValue::Value(U128(amount.0 - used))
    }

    /// Sends the claimable USDC of the caller's tokens.
    pub fn claim(&mut self, token_ids: Vec<TokenId>) -> Promise {
        let account = env::predecessor_account_id();
        let mut total = 0;
        for id in &token_ids {
            require!(self.tokens.owner_by_id.get(id).as_ref() == Some(&account), "Not your token");
            let life = self.lives.get(id).unwrap().clone();
            let amount = self.claimable(&life);
            total += amount;
            self.lives.get_mut(id).unwrap().claimed += amount;
        }
        let total = total.min(self.held);
        require!(total > 0, "Nothing to claim");
        self.held -= total;
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account.clone(), U128(total), None)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CLAIM_CALLBACK).on_claim(account, token_ids, U128(total)))
    }

    /// A failed transfer puts the amounts back as claimable.
    #[private]
    pub fn on_claim(&mut self, account_id: AccountId, token_ids: Vec<TokenId>, total: U128, #[callback_result] r: Result<(), PromiseError>) -> bool {
        if r.is_ok() {
            env::log_str(&format!("{account_id} claimed {}", total.0));
            return true;
        }
        self.held += total.0;
        let mut left = total.0;
        for id in token_ids {
            let life = self.lives.get_mut(&id).unwrap();
            let back = life.claimed.min(left);
            life.claimed -= back;
            left -= back;
        }
        false
    }

    pub fn set_house(&mut self, house: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        self.house = house;
    }

    // Views

    pub fn life_info(&self, token_id: TokenId) -> Option<LifeInfo> {
        let life = self.lives.get(&token_id)?;
        let owner_id = self.tokens.owner_by_id.get(&token_id)?;
        Some(self.info(token_id, owner_id, life))
    }

    pub fn lives_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<LifeInfo> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
            .into_iter()
            .filter_map(|t| self.lives.get(&t.token_id).map(|l| self.info(t.token_id.clone(), t.owner_id, l)))
            .collect()
    }

    pub fn total_owed_remaining(&self) -> U128 {
        U128(self.acc.total_remaining)
    }

    pub fn held(&self) -> U128 {
        U128(self.held)
    }
}

impl ExtraLife {
    fn paid(&self, life: &Life) -> u128 {
        let frozen = self.cohorts.get(&life.epoch).and_then(|c| c.expired_at);
        let now = frozen.unwrap_or_else(|| self.acc.snapshot());
        life.owed - remaining_as_of(life.owed, life.at, now)
    }

    fn expired(&self, life: &Life) -> bool {
        self.cohorts.get(&life.epoch).is_some_and(|c| c.expired_at.is_some())
    }

    fn claimable(&self, life: &Life) -> u128 {
        self.paid(life).saturating_sub(life.claimed)
    }

    fn info(&self, token_id: TokenId, owner_id: AccountId, life: &Life) -> LifeInfo {
        let paid = self.paid(life);
        LifeInfo {
            token_id,
            owner_id,
            epoch: life.epoch,
            face: U128(life.face),
            cap_ppm: U128(life.cap_ppm),
            owed: U128(life.owed),
            paid: U128(paid),
            claimable: U128(paid.saturating_sub(life.claimed)),
            full_heal: paid >= life.owed,
            expired: self.expired(life),
        }
    }
}

fn fmt_usdc(x: u128) -> String {
    format!("{}.{:02}", x / math::USDC, (x % math::USDC) / 10_000)
}

fn fmt_ppm(x: u128) -> String {
    format!("{}.{:02}", x / math::PPM, (x % math::PPM) / 10_000)
}

// NEP-171 plumbing

#[near]
impl NonFungibleTokenCore for ExtraLife {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        self.tokens.nft_transfer(receiver_id, token_id, approval_id, memo)
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.tokens.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for ExtraLife {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.tokens.nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approved_account_ids)
    }
}

#[near]
impl NonFungibleTokenApproval for ExtraLife {
    #[payable]
    fn nft_approve(&mut self, token_id: TokenId, account_id: AccountId, msg: Option<String>) -> Option<Promise> {
        self.tokens.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.tokens.nft_revoke(token_id, account_id)
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.tokens.nft_revoke_all(token_id)
    }

    fn nft_is_approved(&self, token_id: TokenId, approved_account_id: AccountId, approval_id: Option<u64>) -> bool {
        self.tokens.nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for ExtraLife {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for ExtraLife {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "OneUp Extra Life".to_string(),
            symbol: "1UPLIFE".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}

#[cfg(test)]
mod tests;
