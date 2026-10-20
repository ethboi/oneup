//! ve1UP: lock $1UP as a veNFT, vote each epoch on which markets get the house's capacity and emissions,
//! and earn that market's buybacks and bribes (spec "ve1UP"; maths §7, §9).
//!
//! Epochs follow the house: at each epoch start the house calls `checkpoint(e)`, which fixes the votes for
//! `e` and sends the shares back. Votes cast during epoch `k` count from `k + 1`.

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
use std::collections::{BTreeMap, HashMap};

pub mod tally;
use tally::{power, Alloc, Tally};

const MAX_MARKETS_PER_VOTE: usize = 10;
const LISTING_BOND: u128 = 500 * math::USDC;
const LISTING_SHARE_PPM: u128 = 20_000;
const LISTING_MAX_IDLE_EPOCHS: u32 = 4;
const LISTING_MAX_LEVERAGE: u32 = 100;
const GAS_ADD_MARKET: Gas = Gas::from_tgas(15);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);
const GAS_SET_SHARES: Gas = Gas::from_tgas(30);

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Lock {
    pub amount: u128,
    pub created: u64,
    /// First epoch with zero power.
    pub end: u64,
    /// (first epoch it counts for, allocation in ppm)
    pub votes: Vec<(u64, Alloc)>,
    pub withdrawn: bool,
}

impl Lock {
    fn alloc_at(&self, e: u64) -> Option<&Alloc> {
        self.votes.iter().rev().find(|(from, _)| *from <= e).map(|(_, a)| a)
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub market_id: String,
    pub feed_id: String,
    pub proposer: AccountId,
    pub created: u64,
    /// Checkpoints in a row with no votes.
    pub idle: u32,
}

#[near(serializers = [json])]
pub struct LockInfo {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub amount: U128,
    pub created: u64,
    pub end: u64,
    /// Power for the next epoch, when current votes count.
    pub power: U128,
    pub votes: Vec<(String, U128)>,
    pub withdrawn: bool,
}

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
enum TransferMsg {
    Lock { epochs: u64 },
    Bribe { market_id: String },
    Buyback { epoch: u64, per_market: Vec<(String, U128)> },
    Propose { market_id: String, feed_id: String },
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    OwnerById,
    Metadata,
    Enumeration,
    Approval,
    Locks,
    Totals,
    Rewards,
    Claimed,
    Owed,
}

#[allow(dead_code)]
#[ext_contract(ext_ft)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[allow(dead_code)]
#[ext_contract(ext_house)]
trait House {
    fn set_vote_shares(&mut self, epoch: u64, shares: Vec<(String, U128)>);
    fn add_market(&mut self, market_id: String, feed_id: String, max_leverage: u32);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Ve {
    owner: AccountId,
    house: AccountId,
    oneup: AccountId,
    usdc: AccountId,
    treasury: AccountId,
    proposals: Vec<Proposal>,
    /// The house's current epoch, as of its last checkpoint.
    epoch: u64,
    tally: Tally,
    tokens: NonFungibleToken,
    locks: LookupMap<TokenId, Lock>,
    next_lock: u64,
    /// Votes per market fixed at each epoch's checkpoint.
    totals: LookupMap<u64, Vec<(String, U128)>>,
    /// (epoch, market) → reward token → amount, for that epoch's voters of that market.
    rewards: LookupMap<(u64, String), BTreeMap<AccountId, u128>>,
    /// (lock, epoch) → reward token → amount already claimed.
    claimed: LookupMap<(TokenId, u64), BTreeMap<AccountId, u128>>,
    /// (account, reward token) → amount owed after a failed transfer.
    owed: LookupMap<(AccountId, AccountId), u128>,
}

#[near]
impl Ve {
    #[init]
    pub fn new(owner: AccountId, house: AccountId, oneup: AccountId, usdc: AccountId, treasury: AccountId) -> Self {
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
            oneup,
            usdc,
            treasury,
            proposals: vec![],
            epoch: 1,
            tally: Tally { processed: 1, ..Default::default() },
            locks: LookupMap::new(StorageKey::Locks),
            next_lock: 1,
            totals: LookupMap::new(StorageKey::Totals),
            rewards: LookupMap::new(StorageKey::Rewards),
            claimed: LookupMap::new(StorageKey::Claimed),
            owed: LookupMap::new(StorageKey::Owed),
        }
    }

    /// Token deposits: `{"lock":{"epochs":n}}` ($1UP) mints a veNFT; `{"bribe":{"market_id"}}` (any token)
    /// rewards next epoch's voters of that market; `{"buyback":{…}}` ($1UP from the house) rewards an
    /// epoch's voters by market.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let msg: TransferMsg = near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Bad message"));
        match msg {
            TransferMsg::Lock { epochs } => {
                require!(token == self.oneup, "Only $1UP can be locked");
                require!((1..=math::VE_MAX_EPOCHS).contains(&epochs), "Lock 1 to 52 epochs");
                self.mint_lock(sender_id, amount.0, epochs);
            }
            TransferMsg::Bribe { market_id } => {
                require!(amount.0 > 0, "Empty bribe");
                self.add_reward(self.epoch + 1, market_id, token, amount.0);
            }
            TransferMsg::Buyback { epoch, per_market } => {
                require!(token == self.oneup && sender_id == self.house, "Only house buybacks");
                let sum: u128 = per_market.iter().map(|(_, a)| a.0).sum();
                require!(sum == amount.0, "Buyback split doesn't add up");
                for (m, a) in per_market {
                    self.add_reward(epoch, m, token.clone(), a.0);
                }
            }
            TransferMsg::Propose { market_id, feed_id } => {
                require!(token == self.usdc && amount.0 == LISTING_BOND, "The bond is 500 USDC");
                require!(!market_id.is_empty() && market_id.len() <= 32, "Bad market id");
                require!(!self.proposals.iter().any(|p| p.market_id == market_id), "Already proposed");
                self.proposals.push(Proposal { market_id, feed_id, proposer: sender_id, created: self.epoch, idle: 0 });
            }
        }
        PromiseOrValue::Value(U128(0))
    }

    /// Spread a lock's votes across markets (ppm, summing to 100%). Counts from the next epoch and stays
    /// until changed.
    pub fn vote(&mut self, token_id: TokenId, allocations: Vec<(String, U128)>) {
        self.assert_lock_owner(&token_id);
        let next = self.epoch + 1;
        let mut lock = self.locks.get(&token_id).unwrap().clone();
        require!(lock.end > next, "Lock has ended");
        require!(!allocations.is_empty() && allocations.len() <= MAX_MARKETS_PER_VOTE, "Vote for 1 to 10 markets");
        let mut alloc: Alloc = vec![];
        for (m, a) in allocations {
            require!(a.0 > 0, "Zero allocation");
            require!(!alloc.iter().any(|(x, _)| *x == m), "Market listed twice");
            alloc.push((m, a.0));
        }
        require!(alloc.iter().map(|(_, a)| a).sum::<u128>() == math::PPM, "Allocations must sum to 1000000");

        if let Some(old) = lock.alloc_at(u64::MAX).cloned() {
            self.tally.remove(lock.amount, lock.end, &old);
        }
        self.tally.add(lock.amount, lock.end, &alloc);
        match lock.votes.last_mut() {
            Some((from, a)) if *from == next => *a = alloc,
            _ => lock.votes.push((next, alloc)),
        }
        self.locks.insert(token_id, lock);
    }

    /// House only, at each epoch start: fixes votes for `epoch` and sends the shares back.
    pub fn checkpoint(&mut self, epoch: u64) {
        require!(env::predecessor_account_id() == self.house, "Only the house");
        require!(epoch > self.epoch, "Epoch already checkpointed");
        let votes = self.tally.checkpoint(epoch);
        self.epoch = epoch;
        let total: u128 = votes.iter().map(|(_, v)| v).sum();
        let shares: Vec<(String, U128)> = if total == 0 {
            vec![]
        } else {
            votes.iter().map(|(m, v)| (m.clone(), U128(v * math::PPM / total))).collect()
        };
        // Listings first, so the house knows a new market before its share arrives.
        let listed = self.settle_proposals(&votes, total);
        self.totals.insert(epoch, votes.into_iter().map(|(m, v)| (m, U128(v))).collect());
        let set = ext_house::ext(self.house.clone()).with_static_gas(GAS_SET_SHARES);
        match listed {
            Some(adds) => adds.then(set.set_vote_shares(epoch, shares)).detach(),
            None => set.set_vote_shares(epoch, shares).detach(),
        }
    }

    /// Pays a lock's buybacks and bribes for finished epochs. Late rewards can be claimed later.
    pub fn claim(&mut self, token_id: TokenId, epochs: Vec<u64>) {
        let account = self.assert_lock_owner(&token_id);
        let lock = self.locks.get(&token_id).unwrap().clone();
        let mut pay: BTreeMap<AccountId, u128> = BTreeMap::new();
        for e in epochs {
            require!(e < self.epoch, "Epoch not finished");
            let due = self.entitled(&lock, e);
            let key = (token_id.clone(), e);
            let mut claimed = self.claimed.get(&key).cloned().unwrap_or_default();
            for (t, amount) in due {
                let c = claimed.entry(t.clone()).or_default();
                if amount > *c {
                    *pay.entry(t).or_default() += amount - *c;
                    *c = amount;
                }
            }
            self.claimed.insert(key, claimed);
        }
        for (t, amount) in pay.iter_mut() {
            *amount += self.owed.remove(&(account.clone(), t.clone())).unwrap_or(0);
        }
        require!(!pay.is_empty(), "Nothing to claim");
        for (t, amount) in pay {
            self.send(t, account.clone(), amount);
        }
    }

    /// Returns the locked $1UP once the lock has ended. The veNFT stays (it can still claim past epochs).
    pub fn unlock(&mut self, token_id: TokenId) {
        let account = self.assert_lock_owner(&token_id);
        let lock = self.locks.get_mut(&token_id).unwrap();
        require!(self.epoch >= lock.end, "Lock still running");
        require!(!lock.withdrawn, "Already unlocked");
        lock.withdrawn = true;
        let amount = lock.amount;
        self.send(self.oneup.clone(), account, amount);
    }

    #[private]
    pub fn on_send(&mut self, token: AccountId, account_id: AccountId, amount: U128, #[callback_result] r: Result<(), PromiseError>) -> bool {
        if r.is_err() {
            let key = (account_id, token);
            let o = self.owed.get(&key).copied().unwrap_or(0);
            self.owed.insert(key, o + amount.0);
            return false;
        }
        true
    }

    // Views

    pub fn get_epoch(&self) -> u64 {
        self.epoch
    }

    pub fn lock_info(&self, token_id: TokenId) -> Option<LockInfo> {
        let lock = self.locks.get(&token_id)?;
        let owner_id = self.tokens.owner_by_id.get(&token_id)?;
        Some(self.info(token_id, owner_id, lock))
    }

    pub fn locks_for_owner(&self, account_id: AccountId) -> Vec<LockInfo> {
        self.tokens
            .nft_tokens_for_owner(account_id, None, Some(100))
            .into_iter()
            .filter_map(|t| self.locks.get(&t.token_id).map(|l| self.info(t.token_id.clone(), t.owner_id, l)))
            .collect()
    }

    /// Votes per market fixed for `epoch`.
    pub fn get_votes(&self, epoch: u64) -> Vec<(String, U128)> {
        self.totals.get(&epoch).cloned().unwrap_or_default()
    }

    /// Votes per market as they stand for the next epoch.
    pub fn get_pending_votes(&self) -> Vec<(String, U128)> {
        let mut t = self.tally.clone();
        t.checkpoint(self.epoch + 1).into_iter().map(|(m, v)| (m, U128(v))).collect()
    }

    pub fn get_proposals(&self) -> Vec<Proposal> {
        self.proposals.clone()
    }

    pub fn get_rewards(&self, epoch: u64, market_id: String) -> Vec<(AccountId, U128)> {
        self.rewards.get(&(epoch, market_id)).map(|r| r.iter().map(|(t, a)| (t.clone(), U128(*a))).collect()).unwrap_or_default()
    }

    pub fn get_claimable(&self, token_id: TokenId, epochs: Vec<u64>) -> Vec<(AccountId, U128)> {
        let Some(lock) = self.locks.get(&token_id) else { return vec![] };
        let mut out: BTreeMap<AccountId, u128> = BTreeMap::new();
        for e in epochs.into_iter().filter(|e| *e < self.epoch) {
            let claimed = self.claimed.get(&(token_id.clone(), e)).cloned().unwrap_or_default();
            for (t, amount) in self.entitled(lock, e) {
                *out.entry(t.clone()).or_default() += amount.saturating_sub(claimed.get(&t).copied().unwrap_or(0));
            }
        }
        out.into_iter().filter(|(_, a)| *a > 0).map(|(t, a)| (t, U128(a))).collect()
    }
}

impl Ve {
    fn assert_lock_owner(&self, token_id: &TokenId) -> AccountId {
        let account = env::predecessor_account_id();
        require!(self.tokens.owner_by_id.get(token_id).as_ref() == Some(&account), "Not your lock");
        account
    }

    fn mint_lock(&mut self, owner: AccountId, amount: u128, epochs: u64) {
        require!(amount > 0, "Nothing to lock");
        let id = self.next_lock.to_string();
        self.next_lock += 1;
        let end = self.epoch + 1 + epochs;
        self.locks.insert(id.clone(), Lock { amount, created: self.epoch, end, votes: vec![], withdrawn: false });
        let metadata = TokenMetadata {
            title: Some(format!("ve1UP #{id}")),
            description: Some(format!("{} $1UP locked until epoch {end}", amount / math::ONEUP)),
            issued_at: Some(env::block_timestamp_ms().to_string()),
            ..Default::default()
        };
        self.tokens.internal_mint_with_refund(id.clone(), owner.clone(), Some(metadata), None);
        NftMint { owner_id: &owner, token_ids: &[&id], memo: None }.emit();
    }

    /// Lists proposals with ≥ 2% of votes (bond back) and drops ones idle for 4 checkpoints (bond to the
    /// treasury). Returns the house calls for the listings.
    fn settle_proposals(&mut self, votes: &[(String, u128)], total: u128) -> Option<Promise> {
        let mut adds: Option<Promise> = None;
        let mut keep = vec![];
        for mut p in std::mem::take(&mut self.proposals) {
            let v = votes.iter().find(|(m, _)| *m == p.market_id).map(|(_, v)| *v).unwrap_or(0);
            if total > 0 && v * math::PPM / total >= LISTING_SHARE_PPM {
                let add = ext_house::ext(self.house.clone())
                    .with_static_gas(GAS_ADD_MARKET)
                    .add_market(p.market_id.clone(), p.feed_id.clone(), LISTING_MAX_LEVERAGE);
                adds = Some(match adds {
                    Some(a) => a.and(add),
                    None => add,
                });
                self.send(self.usdc.clone(), p.proposer.clone(), LISTING_BOND);
            } else if v == 0 && p.idle + 1 >= LISTING_MAX_IDLE_EPOCHS {
                self.send(self.usdc.clone(), self.treasury.clone(), LISTING_BOND);
            } else {
                p.idle = if v == 0 { p.idle + 1 } else { 0 };
                keep.push(p);
            }
        }
        self.proposals = keep;
        adds
    }

    fn add_reward(&mut self, epoch: u64, market_id: String, token: AccountId, amount: u128) {
        let key = (epoch, market_id);
        let mut r = self.rewards.get(&key).cloned().unwrap_or_default();
        *r.entry(token).or_default() += amount;
        self.rewards.insert(key, r);
    }

    /// Everything a lock has earned for epoch `e`, by reward token.
    fn entitled(&self, lock: &Lock, e: u64) -> BTreeMap<AccountId, u128> {
        let mut out = BTreeMap::new();
        let (Some(alloc), Some(totals)) = (lock.alloc_at(e), self.totals.get(&e)) else { return out };
        for (m, a) in alloc {
            let Some((_, total)) = totals.iter().find(|(x, _)| x == m) else { continue };
            let p = power(lock.amount, *a, lock.end, e);
            if let Some(r) = self.rewards.get(&(e, m.clone())) {
                for (t, amount) in r {
                    *out.entry(t.clone()).or_default() += math::pro_rata(*amount, p, total.0);
                }
            }
        }
        out
    }

    fn info(&self, token_id: TokenId, owner_id: AccountId, lock: &Lock) -> LockInfo {
        let votes = lock.alloc_at(u64::MAX).cloned().unwrap_or_default();
        LockInfo {
            token_id,
            owner_id,
            amount: U128(lock.amount),
            created: lock.created,
            end: lock.end,
            power: U128(power(lock.amount, math::PPM, lock.end, self.epoch + 1)),
            votes: votes.into_iter().map(|(m, a)| (m, U128(a))).collect(),
            withdrawn: lock.withdrawn,
        }
    }

    fn send(&self, token: AccountId, account: AccountId, amount: u128) {
        ext_ft::ext(token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account.clone(), U128(amount), None)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_send(token, account, U128(amount)))
            .detach();
    }
}

// NEP-171 plumbing (veNFTs are transferable; rewards go to the current owner)

#[near]
impl NonFungibleTokenCore for Ve {
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
impl NonFungibleTokenResolver for Ve {
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
impl NonFungibleTokenApproval for Ve {
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
impl NonFungibleTokenEnumeration for Ve {
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
impl NonFungibleTokenMetadataProvider for Ve {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "ve1UP".to_string(),
            symbol: "VE1UP".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}

#[cfg(test)]
mod tests;
