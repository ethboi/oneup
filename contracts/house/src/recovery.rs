//! Durable receipt recovery. A batch is removed only after both destinations confirm it. Retrying a
//! timed-out receipt is safe: Life IDs and ve's batch receipt are idempotent at the receiving contract.
use near_sdk::{env, ext_contract, near, AccountId, Gas, NearToken, Promise, PromiseError};
use near_sdk::json_types::U128;
use crate::{now_s, House, HouseExt};
use crate::epochs::{ext_life, MintItem};
use crate::oracle::ext_ft;

pub const RETRY_AFTER_S: u64 = 60;

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct RecoveryBatch {
    pub epoch: u64,
    pub created: u64,
    pub for_close: bool,
    pub lives: Vec<(AccountId, u128, u128)>,
    pub locks: Vec<(AccountId, u128)>,
    pub life_done: bool,
    pub locks_done: bool,
    pub life_attempt: u64,
    pub locks_attempt: u64,
    pub life_sent_at: Option<u64>,
    pub locks_sent_at: Option<u64>,
}

#[near(serializers = [json])]
pub struct RecoveryView {
    pub batch_id: u64,
    pub epoch: u64,
    pub lock_created_epoch: u64,
    pub for_close: bool,
    pub lives: Vec<MintItem>,
    pub locks: Vec<(AccountId, U128)>,
    pub life_confirmed: bool,
    pub locks_confirmed: bool,
    pub life_attempt: u64,
    pub locks_attempt: u64,
}

#[allow(dead_code)]
#[ext_contract(ext_recovery_ve)]
trait RecoveryVe {
    fn get_recovery_receipt(&self, batch_id: u64) -> Option<Vec<u8>>;
}

impl RecoveryBatch {
    pub fn fingerprint(&self) -> Vec<u8> {
        let items: Vec<_> = self.locks.iter().map(|(a, n)| (a, U128(*n))).collect();
        env::sha256(&near_sdk::serde_json::to_vec(&(self.created, items)).unwrap())
    }
}

#[near]
impl House {
    /// Permissionless retry. The same automatic retry is performed by `close_epoch`; this also lets
    /// a backer recover a failed lock without waiting for the epoch boundary.
    pub fn retry_recovery(&mut self, batch_id: u64) -> bool {
        self.dispatch_recovery(batch_id)
    }

    pub fn get_recovery_batches(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<RecoveryView> {
        self.recovery_batches.iter().skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(20).min(100) as usize).map(|(id, b)| RecoveryView {
                batch_id: *id, epoch: b.epoch, lock_created_epoch: b.created, for_close: b.for_close,
                lives: b.lives.iter().map(|(o, f, c)| MintItem { owner: o.clone(), face: U128(*f), cap_ppm: U128(*c) }).collect(),
                locks: b.locks.iter().map(|(o, a)| (o.clone(), U128(*a))).collect(),
                life_confirmed: b.life_done, locks_confirmed: b.locks_done,
                life_attempt: b.life_attempt, locks_attempt: b.locks_attempt,
            }).collect()
    }

    #[private]
    pub fn on_recovery_lives(&mut self, batch_id: u64, attempt: u64, #[callback_result] result: Result<Vec<String>, PromiseError>) -> bool {
        let Some(mut b) = self.recovery_batches.get(&batch_id).cloned() else { return false };
        if b.life_done || b.life_attempt != attempt { return false; }
        let expected: Vec<_> = b.lives.iter().map(|(owner, _, _)| format!("{}:{owner}", b.epoch)).collect();
        let confirmed = result.is_ok_and(|ids| ids == expected);
        b.life_sent_at = None;
        if confirmed {
            b.life_done = true;
            if let Some(c) = self.closing.as_mut().filter(|c| c.epoch.id == b.epoch) {
                c.pending_mints -= 1;
                c.lives_minted += b.lives.len() as u32;
            }
        }
        self.save_recovery(batch_id, b);
        confirmed
    }

    /// The FT resolver has completed before this runs. Always read the receiver's durable receipt:
    /// used=0 can mean a fully refunded duplicate of a previously successful transfer.
    #[private]
    pub fn on_recovery_transfer(&mut self, batch_id: u64, attempt: u64, #[callback_result] _used: Result<U128, PromiseError>) -> Promise {
        ext_recovery_ve::ext(self.ve.clone().expect("ve"))
            .with_static_gas(Gas::from_tgas(5)).get_recovery_receipt(batch_id)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).on_recovery_locks(batch_id, attempt))
    }

    #[private]
    pub fn on_recovery_locks(&mut self, batch_id: u64, attempt: u64, #[callback_result] receipt: Result<Option<Vec<u8>>, PromiseError>) -> bool {
        let Some(mut b) = self.recovery_batches.get(&batch_id).cloned() else { return false };
        if b.locks_done || b.locks_attempt != attempt { return false; }
        let confirmed = receipt.is_ok_and(|r| r == Some(b.fingerprint()));
        b.locks_sent_at = None;
        if confirmed {
            b.locks_done = true;
            if b.for_close {
                if let Some(c) = self.closing.as_mut().filter(|c| c.epoch.id == b.epoch) { c.pending_mints -= 1; }
                let total = b.locks.iter().map(|(_, a)| a).sum::<u128>();
                if let Some(r) = self.emissions.get_mut(&b.epoch) { r.locked.0 += total; }
            } else {
                self.pending_backer_locks -= 1;
            }
        }
        self.save_recovery(batch_id, b);
        confirmed
    }
}

impl House {
    pub(crate) fn queue_recovery(&mut self, epoch: u64, created: u64, lives: Vec<(AccountId, u128, u128)>, locks: Vec<(AccountId, u128)>, for_close: bool) -> u64 {
        let id = self.next_recovery_batch;
        self.next_recovery_batch += 1;
        self.lives_owed += lives.iter().map(|(_, f, c)| oneup_math::owed(*f, *c)).sum::<u128>();
        self.recovery_batches.insert(id, RecoveryBatch {
            epoch, created, for_close, life_done: lives.is_empty(), locks_done: locks.is_empty(), lives, locks,
            life_attempt: 0, locks_attempt: 0, life_sent_at: None, locks_sent_at: None,
        });
        self.dispatch_recovery(id);
        id
    }

    pub(crate) fn retry_first_recovery(&mut self) -> bool {
        let id = self.recovery_batches.keys().next().copied();
        id.is_some_and(|id| self.dispatch_recovery(id))
    }

    fn save_recovery(&mut self, id: u64, b: RecoveryBatch) {
        if b.life_done && b.locks_done { self.recovery_batches.remove(&id); }
        else { self.recovery_batches.insert(id, b); }
    }

    fn dispatch_recovery(&mut self, id: u64) -> bool {
        let Some(mut b) = self.recovery_batches.get(&id).cloned() else { return false };
        let due = |sent: Option<u64>| sent.is_none_or(|t| now_s() >= t.saturating_add(RETRY_AFTER_S));
        let mut sent = false;
        if !b.life_done && due(b.life_sent_at) {
            b.life_attempt += 1;
            b.life_sent_at = Some(now_s());
            let items: Vec<_> = b.lives.iter().map(|(o, f, c)| MintItem { owner: o.clone(), face: U128(*f), cap_ppm: U128(*c) }).collect();
            ext_life::ext(self.life.clone().expect("life"))
                .with_static_gas(Gas::from_tgas(10 + 6 * items.len() as u64)).mint_batch(b.epoch, items)
                .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).on_recovery_lives(id, b.life_attempt)).detach();
            sent = true;
        }
        if !b.locks_done && due(b.locks_sent_at) {
            b.locks_attempt += 1;
            b.locks_sent_at = Some(now_s());
            let items: Vec<_> = b.locks.iter().map(|(o, a)| (o, U128(*a))).collect();
            let msg = near_sdk::serde_json::json!({"recovery_locks": {"batch_id": id, "created": b.created, "items": items}}).to_string();
            ext_ft::ext(self.oneup.clone().expect("oneup"))
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(Gas::from_tgas(30 + 6 * items.len() as u64))
                .ft_transfer_call(self.ve.clone().expect("ve"), U128(b.locks.iter().map(|(_, a)| a).sum()), None, msg)
                .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(35)).on_recovery_transfer(id, b.locks_attempt)).detach();
            sent = true;
        }
        self.recovery_batches.insert(id, b);
        sent
    }
}
