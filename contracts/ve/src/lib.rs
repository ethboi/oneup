//! ve1UP: lock $1UP for 1 to 104 epochs as a transferable NFT and earn the house's $1UP buybacks, shared
//! each epoch by lock weight (amount × epochs left ÷ 104). Leaving early costs up to half the lock, in
//! proportion to the time left, and the penalty goes to the lockers who stay. Losers' $1UP arrives here as
//! 104-epoch locks (decisions D-15, D-16; maths §9).
//!
//! Epochs follow the house: at each epoch start the house calls `checkpoint(e)`, which fixes the total
//! weight for `e`. A lock counts from the epoch after it's made.
//!
//! A closed lock (unlocked, left early or merged away) loses its approvals and can't be approved or moved,
//! so no listing can sell it empty. Claiming a lock's rewards also drops its approvals, so a listing can't
//! be drained before it sells.

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{NonFungibleTokenCore, NonFungibleTokenResolver};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{refund_approved_account_ids, NonFungibleToken, Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};
use oneup_math as math;
use std::collections::HashMap;

pub mod tally;
use tally::{power, Tally};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);
/// Locks the house can create in one `lock_for` transfer.
const MAX_LOCKS_PER_TRANSFER: usize = 30;
/// Locks claimed or merged in one call.
const MAX_LOCKS_PER_CALL: usize = 30;
/// Smallest lock made by hand (each lock costs storage). The house's loser locks can be smaller.
pub const MIN_LOCK: u128 = math::ONEUP;

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Lock {
    pub amount: u128,
    pub created: u64,
    /// First epoch with zero weight.
    pub end: u64,
    /// Made by the house from a loss (D-16) rather than locked by hand.
    pub from_loss: bool,
    /// Left early (or merged away) in this epoch: earns for epochs up to and including it.
    pub exited: Option<u64>,
    pub withdrawn: bool,
    /// Locks merged into this one; their unclaimed rewards are claimed through it.
    pub merged_from: Vec<TokenId>,
    /// This lock was merged into another and can no longer be claimed directly.
    pub merged_into: Option<TokenId>,
}

#[near(serializers = [json])]
pub struct LockInfo {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub amount: U128,
    pub created: u64,
    pub end: u64,
    pub from_loss: bool,
    /// Weight for the next epoch.
    pub power: U128,
    /// What leaving now would cost (0 once the lock has ended).
    pub exit_penalty: U128,
    pub exited: Option<u64>,
    pub withdrawn: bool,
    /// How many locks were merged into this one.
    pub merged: u32,
}

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
enum TransferMsg {
    Lock { epochs: u64 },
    /// House only: one max-length lock per loser.
    LockFor { items: Vec<(AccountId, U128)> },
    RecoveryLocks { batch_id: u64, created: u64, items: Vec<(AccountId, U128)> },
    /// House only: an epoch's buyback, for that epoch's lockers.
    Buyback { epoch: u64 },
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
    RecoveryReceipts,
    InFlight,
}

#[allow(dead_code)]
#[ext_contract(ext_ft)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(serializers = [json])]
pub struct LocksPage {
    pub locks: Vec<LockInfo>,
    pub next_index: Option<U128>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Ve {
    owner: AccountId,
    house: AccountId,
    oneup: AccountId,
    /// The house's current epoch, as of its last checkpoint.
    epoch: u64,
    tally: Tally,
    tokens: NonFungibleToken,
    locks: LookupMap<TokenId, Lock>,
    next_lock: u64,
    /// Total weight fixed at each epoch's checkpoint.
    totals: LookupMap<u64, u128>,
    /// $1UP for each epoch's lockers: buybacks, and penalties from early exits.
    rewards: LookupMap<u64, u128>,
    /// (lock, epoch) → $1UP already claimed.
    claimed: LookupMap<(TokenId, u64), u128>,
    /// $1UP owed after a failed transfer.
    owed: LookupMap<AccountId, u128>,
    recovery_receipts: LookupMap<u64, Vec<u8>>,
    /// Per token: transfer calls still waiting on their receiver, and whether it paid out meanwhile. A token
    /// that paid out during a transfer call doesn't get its old approvals back when it returns, or a buyer could
    /// use an old listing to buy what the temporary holder emptied.
    in_flight: LookupMap<TokenId, (u32, bool)>,
}

#[near]
impl Ve {
    #[init]
    pub fn new(owner: AccountId, house: AccountId, oneup: AccountId) -> Self {
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
            epoch: 1,
            tally: Tally { processed: 1, ..Default::default() },
            locks: LookupMap::new(StorageKey::Locks),
            next_lock: 1,
            totals: LookupMap::new(StorageKey::Totals),
            rewards: LookupMap::new(StorageKey::Rewards),
            claimed: LookupMap::new(StorageKey::Claimed),
            owed: LookupMap::new(StorageKey::Owed),
            recovery_receipts: LookupMap::new(StorageKey::RecoveryReceipts),
            in_flight: LookupMap::new(StorageKey::InFlight),
        }
    }

    /// $1UP deposits: `{"lock":{"epochs":n}}` mints a lock NFT for the sender; from the house,
    /// `{"lock_for":{"items":[[owner, amount], …]}}` mints max-length locks for losers and
    /// `{"buyback":{"epoch":e}}` rewards epoch `e`'s lockers.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.oneup, "Only $1UP");
        let msg: TransferMsg = near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Bad message"));
        match msg {
            TransferMsg::Lock { epochs } => {
                require!((1..=math::VE_MAX_EPOCHS).contains(&epochs), "Lock 1 to 104 epochs");
                require!(amount.0 >= MIN_LOCK, "Lock at least 1 $1UP");
                self.mint_lock(sender_id, amount.0, epochs, false);
            }
            TransferMsg::LockFor { items } => {
                require!(sender_id == self.house, "Only the house");
                require!(items.len() <= MAX_LOCKS_PER_TRANSFER, "Too many locks in one transfer");
                require!(items.iter().map(|(_, a)| a.0).sum::<u128>() == amount.0, "Locks don't add up");
                // no MIN_LOCK here: a small loss still gets its lock, and only the house can make these
                for (owner, a) in items {
                    self.mint_lock(owner, a.0, math::VE_MAX_EPOCHS, true);
                }
            }
            TransferMsg::RecoveryLocks { batch_id, created, items } => {
                require!(sender_id == self.house, "Only the house");
                require!(!items.is_empty() && items.len() <= MAX_LOCKS_PER_TRANSFER, "Invalid recovery batch size");
                require!(items.iter().all(|(_, a)| a.0 > 0), "Nothing to lock");
                require!(items.iter().map(|(_, a)| a.0).sum::<u128>() == amount.0, "Locks don't add up");
                let fingerprint = env::sha256(&near_sdk::serde_json::to_vec(&(created, &items)).unwrap());
                if let Some(previous) = self.recovery_receipts.get(&batch_id) {
                    require!(*previous == fingerprint, "Conflicting lock entitlement");
                    return PromiseOrValue::Value(amount); // duplicate deposit is refunded in full
                }
                // Closing waits for this batch, so its creation epoch cannot legitimately be past.
                // A failed checkpoint is repaired here before minting, fixing the original earning window.
                require!(created >= self.epoch, "Recovery epoch already passed");
                if created > self.epoch { self.advance_checkpoint(created); }
                for (owner, a) in items { self.mint_lock(owner, a.0, math::VE_MAX_EPOCHS, true); }
                self.recovery_receipts.insert(batch_id, fingerprint);
            }
            TransferMsg::Buyback { epoch } => {
                require!(sender_id == self.house, "Only the house");
                // an epoch nobody was locked for passes its buyback to the next open epoch
                let e = if self.totals.get(&epoch).copied().unwrap_or(0) > 0 { epoch } else { self.epoch + 1 };
                self.add_reward(e, amount.0);
            }
        }
        PromiseOrValue::Value(U128(0))
    }

    /// House only, at each epoch start: fixes the total weight for `epoch`.
    pub fn checkpoint(&mut self, epoch: u64) {
        require!(env::predecessor_account_id() == self.house, "Only the house");
        // An idempotent recovery transfer may have repaired this checkpoint already.
        require!(epoch >= self.epoch, "Epoch already checkpointed");
        if epoch > self.epoch { self.advance_checkpoint(epoch); }
    }

    pub fn get_recovery_receipt(&self, batch_id: u64) -> Option<Vec<u8>> {
        self.recovery_receipts.get(&batch_id).cloned()
    }

    /// Pays a lock's rewards for finished epochs. Rewards that arrive late can be claimed later.
    pub fn claim(&mut self, token_id: TokenId, epochs: Vec<u64>) {
        self.claim_many(vec![token_id], epochs);
    }

    /// Pays several locks' rewards in one transfer. A lock that pays out loses its approvals (and so any
    /// listing), so a buyer never gets a lock drained after it was listed.
    pub fn claim_many(&mut self, token_ids: Vec<TokenId>, epochs: Vec<u64>) {
        require!(!token_ids.is_empty() && token_ids.len() <= MAX_LOCKS_PER_CALL, "Claim 1 to 30 locks");
        let mut account = None;
        let mut pay = 0;
        for token_id in token_ids {
            let owner = self.assert_lock_owner(&token_id);
            account = Some(owner.clone());
            let lock = self.locks.get(&token_id).unwrap();
            require!(lock.merged_into.is_none(), "Merged into another lock: claim that one");
            let mut paid = 0;
            for e in &epochs {
                require!(*e < self.epoch, "Epoch not finished");
                let key = (token_id.clone(), *e);
                let due = self.available(&token_id, *e);
                let claimed = self.claimed.get(&key).copied().unwrap_or(0);
                if due > claimed {
                    paid += due - claimed;
                    self.claimed.insert(key, due);
                }
            }
            if paid > 0 {
                self.revoke_all(&token_id, owner);
            }
            pay += paid;
        }
        let account = account.unwrap();
        pay += self.owed.remove(&account).unwrap_or(0);
        require!(pay > 0, "Nothing to claim");
        self.send(account, pay);
    }

    /// Merges running locks you own into one new lock: the amounts add up and it ends at the latest
    /// end. It counts from the next epoch; the old locks earn through this one, claimed through the new
    /// lock. Returns the new lock's id.
    pub fn merge(&mut self, token_ids: Vec<TokenId>) -> TokenId {
        require!((2..=MAX_LOCKS_PER_CALL).contains(&token_ids.len()), "Merge 2 to 30 locks");
        let epoch = self.epoch;
        let mut owner = None;
        let (mut amount, mut end, mut from_loss) = (0u128, 0u64, true);
        for id in &token_ids {
            owner = Some(self.assert_lock_owner(id));
            let mut lock = self.locks.get(id).unwrap().clone();
            require!(!lock.withdrawn && lock.merged_into.is_none(), "Lock already closed");
            require!(epoch < lock.end, "Lock has ended: unlock it instead");
            require!(token_ids.iter().filter(|x| *x == id).count() == 1, "Lock listed twice");
            self.tally.remove(lock.amount, lock.end);
            amount += lock.amount;
            end = end.max(lock.end);
            from_loss &= lock.from_loss;
            lock.exited = Some(epoch);
            lock.withdrawn = true;
            self.locks.insert(id.clone(), lock);
            self.revoke_all(id, owner.clone().unwrap());
        }
        let new_id = self.mint(owner.unwrap(), amount, end, from_loss, token_ids.clone());
        for id in token_ids {
            self.locks.get_mut(&id).unwrap().merged_into = Some(new_id.clone());
        }
        new_id
    }

    /// Returns the locked $1UP once the lock has ended. The NFT stays (it can still claim past epochs).
    pub fn unlock(&mut self, token_id: TokenId) {
        let account = self.assert_lock_owner(&token_id);
        let epoch = self.epoch;
        let lock = self.locks.get_mut(&token_id).unwrap();
        require!(epoch >= lock.end, "Lock still running");
        require!(!lock.withdrawn, "Already unlocked");
        require!(lock.merged_into.is_none(), "Merged into another lock");
        lock.withdrawn = true;
        let amount = lock.amount;
        self.revoke_all(&token_id, account.clone());
        self.send(account, amount);
    }

    /// Leaves a running lock now, paying `exit_penalty` (up to half, by time left) to the lockers who stay.
    /// The lock still earns for the current epoch and before.
    pub fn exit_early(&mut self, token_id: TokenId) -> U128 {
        let account = self.assert_lock_owner(&token_id);
        let epoch = self.epoch;
        let mut lock = self.locks.get(&token_id).unwrap().clone();
        require!(!lock.withdrawn, "Already unlocked");
        require!(epoch < lock.end, "Lock has ended: unlock it instead");
        let penalty = math::exit_penalty(lock.amount, lock.end - epoch - 1);
        self.tally.remove(lock.amount, lock.end);
        lock.exited = Some(epoch);
        lock.withdrawn = true;
        let amount = lock.amount;
        self.locks.insert(token_id.clone(), lock);
        self.revoke_all(&token_id, account.clone());
        if penalty > 0 {
            self.add_reward(epoch + 1, penalty);
        }
        if amount > penalty {
            self.send(account, amount - penalty);
        }
        U128(penalty)
    }

    #[private]
    pub fn on_send(&mut self, account_id: AccountId, amount: U128, #[callback_result] r: Result<(), PromiseError>) -> bool {
        if r.is_err() {
            let o = self.owed.get(&account_id).copied().unwrap_or(0);
            self.owed.insert(account_id, o + amount.0);
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
            .filter_map(|t| self.locks.get(&t.token_id).filter(|l| l.merged_into.is_none()).map(|l| self.info(t.token_id.clone(), t.owner_id, l)))
            .collect()
    }

    /// Cursor advances over all owned NFTs, including merged/withdrawn ones, before filtering.
    pub fn locks_for_owner_page(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> LocksPage {
        let from = from_index.unwrap_or(U128(0));
        let limit = limit.unwrap_or(100).clamp(1, 100);
        let total = self.tokens.nft_supply_for_owner(account_id.clone()).0;
        if from.0 >= total { return LocksPage { locks: vec![], next_index: None }; }
        let tokens = self.tokens.nft_tokens_for_owner(account_id, Some(from), Some(limit));
        let count = tokens.len() as u64;
        let next_index = (from.0 + (count as u128) < total).then(|| U128(from.0 + count as u128));
        let locks = tokens.into_iter().filter_map(|t| self.locks.get(&t.token_id).filter(|l| l.merged_into.is_none()).map(|l| self.info(t.token_id.clone(), t.owner_id, l))).collect();
        LocksPage { locks, next_index }
    }

    pub fn get_claimable_many(&self, token_ids: Vec<TokenId>, epochs: Vec<u64>) -> Vec<(TokenId, U128)> {
        require!(token_ids.len() <= MAX_LOCKS_PER_CALL, "At most 30 locks");
        token_ids.into_iter().map(|id| { let due = self.get_claimable(id.clone(), epochs.clone()); (id, due) }).collect()
    }

    /// Total weight fixed for `epoch`.
    pub fn get_total_power(&self, epoch: u64) -> U128 {
        U128(self.totals.get(&epoch).copied().unwrap_or(0))
    }

    /// Total weight as it stands for the next epoch.
    pub fn get_pending_power(&self) -> U128 {
        U128(self.tally.clone().checkpoint(self.epoch + 1))
    }

    pub fn get_rewards(&self, epoch: u64) -> U128 {
        U128(self.rewards.get(&epoch).copied().unwrap_or(0))
    }

    pub fn get_claimable(&self, token_id: TokenId, epochs: Vec<u64>) -> U128 {
        let Some(lock) = self.locks.get(&token_id) else { return U128(0) };
        if lock.merged_into.is_some() {
            return U128(0);
        }
        let total = epochs
            .into_iter()
            .filter(|e| *e < self.epoch)
            .map(|e| self.available(&token_id, e).saturating_sub(self.claimed.get(&(token_id.clone(), e)).copied().unwrap_or(0)))
            .sum();
        U128(total)
    }
}

impl Ve {
    fn advance_checkpoint(&mut self, epoch: u64) {
        let total = self.tally.checkpoint(epoch);
        self.totals.insert(epoch, total);
        if total == 0 {
            if let Some(r) = self.rewards.remove(&epoch) { self.add_reward(epoch + 1, r); }
        }
        self.epoch = epoch;
    }

    fn assert_lock_owner(&self, token_id: &TokenId) -> AccountId {
        let account = env::predecessor_account_id();
        require!(self.tokens.owner_by_id.get(token_id).as_ref() == Some(&account), "Not your lock");
        account
    }

    /// Unlocked, left early or merged away: nothing left to sell.
    fn closed(&self, token_id: &TokenId) -> bool {
        self.locks.get(token_id).is_some_and(|l| l.withdrawn || l.merged_into.is_some())
    }

    /// Drops every approval on a lock, refunding their storage to the owner.
    fn revoke_all(&mut self, token_id: &TokenId, owner: AccountId) {
        if let Some(t) = self.in_flight.get_mut(token_id) {
            t.1 = true;
        }
        if let Some(approvals) = self.tokens.approvals_by_id.as_mut().and_then(|a| a.remove(token_id)) {
            refund_approved_account_ids(owner, &approvals).detach();
        }
    }

    fn mint_lock(&mut self, owner: AccountId, amount: u128, epochs: u64, from_loss: bool) {
        require!(amount > 0, "Nothing to lock");
        let end = self.epoch + 1 + epochs;
        self.mint(owner, amount, end, from_loss, vec![]);
    }

    fn mint(&mut self, owner: AccountId, amount: u128, end: u64, from_loss: bool, merged_from: Vec<TokenId>) -> TokenId {
        let id = self.next_lock.to_string();
        self.next_lock += 1;
        self.tally.add(amount, end);
        self.locks.insert(
            id.clone(),
            Lock { amount, created: self.epoch, end, from_loss, exited: None, withdrawn: false, merged_from, merged_into: None },
        );
        let metadata = TokenMetadata {
            title: Some(format!("ve1UP #{id}")),
            description: Some(format!("{} $1UP locked until epoch {end}", amount / math::ONEUP)),
            issued_at: Some(env::block_timestamp_ms().to_string()),
            ..Default::default()
        };
        self.tokens.internal_mint_with_refund(id.clone(), owner.clone(), Some(metadata), None);
        NftMint { owner_id: &owner, token_ids: &[&id], memo: None }.emit();
        id
    }

    fn add_reward(&mut self, epoch: u64, amount: u128) {
        let r = self.rewards.get(&epoch).copied().unwrap_or(0);
        self.rewards.insert(epoch, r + amount);
    }

    /// What a lock has earned for epoch `e`: its share of the epoch's rewards by weight.
    fn entitled(&self, lock: &Lock, e: u64) -> u128 {
        if e <= lock.created || lock.exited.is_some_and(|x| e > x) {
            return 0;
        }
        let total = self.totals.get(&e).copied().unwrap_or(0);
        let reward = self.rewards.get(&e).copied().unwrap_or(0);
        math::pro_rata(reward, power(lock.amount, lock.end, e), total)
    }

    /// What can be paid through a lock for epoch `e`: its own share plus whatever the locks merged into it
    /// earned and didn't claim before the merge.
    fn available(&self, token_id: &TokenId, e: u64) -> u128 {
        let lock = self.locks.get(token_id).unwrap();
        let mut due = self.entitled(lock, e);
        for from in &lock.merged_from {
            let claimed = self.claimed.get(&(from.clone(), e)).copied().unwrap_or(0);
            due += self.available(from, e).saturating_sub(claimed);
        }
        due
    }

    fn info(&self, token_id: TokenId, owner_id: AccountId, lock: &Lock) -> LockInfo {
        let running = !lock.withdrawn && self.epoch < lock.end;
        LockInfo {
            token_id,
            owner_id,
            amount: U128(lock.amount),
            created: lock.created,
            end: lock.end,
            from_loss: lock.from_loss,
            power: U128(if lock.withdrawn { 0 } else { power(lock.amount, lock.end, self.epoch + 1) }),
            exit_penalty: U128(if running { math::exit_penalty(lock.amount, lock.end - self.epoch - 1) } else { 0 }),
            exited: lock.exited,
            withdrawn: lock.withdrawn,
            merged: lock.merged_from.len() as u32,
        }
    }

    fn send(&self, account: AccountId, amount: u128) {
        ext_ft::ext(self.oneup.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account.clone(), U128(amount), None)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_send(account, U128(amount)))
            .detach();
    }
}

// NEP-171 plumbing (open locks are transferable; rewards go to the current owner)

#[near]
impl NonFungibleTokenCore for Ve {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        require!(!self.closed(&token_id), "Lock is closed");
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
        require!(!self.closed(&token_id), "Lock is closed");
        let count = self.in_flight.get(&token_id).map_or(0, |t| t.0);
        let changed = self.in_flight.get(&token_id).is_some_and(|t| t.1);
        self.in_flight.insert(token_id.clone(), (count + 1, changed));
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
        let (count, changed) = self.in_flight.get(&token_id).copied().unwrap_or((1, false));
        if count <= 1 {
            self.in_flight.remove(&token_id);
        } else {
            self.in_flight.insert(token_id.clone(), (count - 1, changed));
        }
        let approvals = if changed {
            if let Some(old) = &approved_account_ids {
                refund_approved_account_ids(previous_owner_id.clone(), old).detach();
            }
            None
        } else {
            approved_account_ids
        };
        self.tokens.nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approvals)
    }
}

#[near]
impl NonFungibleTokenApproval for Ve {
    #[payable]
    fn nft_approve(&mut self, token_id: TokenId, account_id: AccountId, msg: Option<String>) -> Option<Promise> {
        require!(!self.closed(&token_id), "Lock is closed");
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
