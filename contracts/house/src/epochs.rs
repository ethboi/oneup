//! Epoch close (maths §5–6). Permissionless and resumable: the keeper calls `close_epoch` until it
//! returns "closed". Trading never pauses; the next epoch starts at the first call.
//!
//! 1. begin: freeze the epoch's counters and its losers; start the next epoch
//! 2. mint: one Extra Life per loser, `limit` per call, sized from the house's net result, and the
//!    loser's share of the epoch's $1UP release as a max-length lock (D-16)
//! 3. wait: until every mint and lock has landed, so this epoch's lives share this epoch's pot (D-4)
//! 4. expire: lives past their window stop earning (D-13); the life contract returns what's still owed
//! 5. pay: the surplus above the reserve → Extra Life pot + buyback USDC; record the summary

use near_sdk::json_types::U128;
use near_sdk::store::IterableMap;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, Promise, PromiseError};
use oneup_math as math;

use crate::events::Event;
use crate::oracle::ext_ft;
use crate::{now_s, Epoch, House, HouseExt, StorageKey};

const GAS_MINT_BASE: Gas = Gas::from_tgas(10);
const GAS_MINT_PER_LIFE: Gas = Gas::from_tgas(6);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(60);
const GAS_POT_CALLBACK: Gas = Gas::from_tgas(15);
const GAS_EXPIRE: Gas = Gas::from_tgas(30);
const GAS_EXPIRE_CALLBACK: Gas = Gas::from_tgas(10);
// each batch mints up to this many lives and as many locks, so it has to fit one transaction's gas
const DEFAULT_BATCH: u32 = 10;
const MAX_BATCH: u32 = 10;

#[near(serializers = [json])]
pub struct MintItem {
    pub owner: AccountId,
    pub face: U128,
    pub cap_ppm: U128,
}

#[allow(dead_code)]
#[ext_contract(ext_life)]
trait ExtraLife {
    fn mint_batch(&mut self, epoch: u64, items: Vec<MintItem>) -> Vec<String>;
    fn mint_backer(&mut self, owner: AccountId, face: U128, cap_ppm: U128) -> String;
    fn expire(&mut self, through_epoch: u64) -> U128;
}

#[near(serializers = [borsh])]
pub struct Closing {
    pub epoch: Epoch,
    pub ended_at: u64,
    pub house_net: u128,
    pub cap_ppm: u128,
    /// Net loss per wallet (losses − profit paid); only those above zero get a life.
    pub losers: IterableMap<AccountId, i128>,
    pub lives_minted: u32,
    pub pending_mints: u32,
    pub expiring: bool,
    pub expired: bool,
    /// $1UP released to this epoch's losers, and how much has been handed out so far.
    pub oneup_release: u128,
    pub oneup_assigned: u128,
    /// D-27: waiting on the vault for USDC the payout needs.
    pub recalling: bool,
    pub draw: Option<crate::treasury::DrawProgress>,
    pub draw_done: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct EpochSummary {
    pub epoch: u64,
    pub started_at: u64,
    pub ended_at: u64,
    pub losses: U128,
    pub payouts: U128,
    pub cuts: U128,
    /// D-28: the marketplace's cut, part of `house_net`.
    #[serde(default)]
    pub fees: U128,
    pub house_net: U128,
    pub cap_ppm: U128,
    pub lives_minted: u32,
    pub pool: U128,
    pub reserve: U128,
    pub surplus: U128,
    pub lives_pot: U128,
    pub buyback_pot: U128,
}

#[near(serializers = [json])]
pub struct ClosingView {
    pub epoch: u64,
    pub house_net: U128,
    pub cap_ppm: U128,
    pub losers_left: u32,
    pub lives_minted: u32,
    pub pending_mints: u32,
}

#[near(serializers = [json])]
pub struct LivesState {
    pub life: Option<AccountId>,
    pub lives_owed: U128,
    pub lives_paid: U128,
    pub buyback_usdc: U128,
}

#[near]
impl House {
    /// Anyone (keeper). Advances the close of the finished epoch by one step and says what it did:
    /// "begun", "minting", "waiting for mints" or "closed".
    pub fn close_epoch(&mut self, limit: Option<u32>) -> String {
        let Some(mut c) = self.closing.take() else {
            require!(now_s() >= self.epoch.started_at + self.params.epoch_length_s, "Epoch not over yet");
            self.closing_requested = true;
            if self.pending_backing > 0 || self.pending_backer_locks > 0 {
                self.retry_first_recovery();
                return "waiting for backing".into();
            }
            if self.pending_pots > 0 { return "waiting for pot".into(); }
            self.closing_requested = false;
            self.begin_close();
            return "begun".into();
        };
        let result = if !self.recovery_batches.is_empty() {
            if self.retry_first_recovery() { "retrying recovery" } else { "waiting for mints" }
        } else if !c.losers.is_empty() {
            let n = limit.unwrap_or(DEFAULT_BATCH).clamp(1, MAX_BATCH) as usize;
            let taken: Vec<(AccountId, i128)> = c.losers.iter().take(n).map(|(k, v)| (k.clone(), *v)).collect();
            for (k, _) in &taken {
                c.losers.remove(k);
            }
            // net winners and wallets that broke even get nothing
            let batch: Vec<(AccountId, u128)> = taken.into_iter().filter(|(_, v)| *v > 0).map(|(k, v)| (k, v as u128)).collect();
            // each dollar of net loss is a jackpot ticket (D-27), house profit or not
            for (owner, loss) in &batch {
                self.add_tickets(owner, *loss);
            }
            if c.house_net > 0 {
                let losses = c.epoch.net_losses.0;
                let batch_losses = batch.clone();
                let items: Vec<(AccountId, u128, u128)> = batch
                    .into_iter()
                    .map(|(owner, loss)| (owner, math::face_value(c.house_net, loss, losses), c.cap_ppm))
                    .filter(|(_, face, _)| *face > 0)
                    .collect();
                let locks: Vec<(AccountId, u128)> = items
                    .iter()
                    .map(|(owner, _, _)| {
                        let loss = batch_losses.iter().find(|(o, _)| o == owner).map(|(_, l)| *l).unwrap_or(0);
                        (owner.clone(), math::pro_rata(c.oneup_release, loss, losses))
                    })
                    .filter(|(_, a)| *a > 0)
                    .collect();
                if !items.is_empty() || !locks.is_empty() {
                    c.pending_mints += u32::from(!items.is_empty()) + u32::from(!locks.is_empty());
                    c.oneup_assigned += locks.iter().map(|(_, a)| a).sum::<u128>();
                    self.queue_recovery(c.epoch.id, c.epoch.id + 1, items, locks, true);
                }
            }
            "minting"
        } else if c.pending_mints > 0 {
            "waiting for mints"
        } else if !c.expired {
            if !c.expiring {
                c.expiring = true;
                // lives minted in epoch m share pots m..=m+expiry, so before paying epoch E's pot,
                // expire everything minted in E − expiry − 1 or earlier
                let through = c.epoch.id.saturating_sub(self.params.life_expiry_epochs + 1);
                ext_life::ext(self.life.clone().expect("life"))
                    .with_static_gas(GAS_EXPIRE)
                    .expire(through)
                    .then(Self::ext(env::current_account_id()).with_static_gas(GAS_EXPIRE_CALLBACK).on_expired())
                    .detach();
                "expiring"
            } else {
                "waiting for expiry"
            }
        } else if c.recalling {
            "waiting for recall"
        } else if let Some(need) = self.recall_needed() {
            // the payout leaves as USDC: bring home what the vault holds of it first (D-27)
            c.recalling = true;
            self.recall_from_vault(need, true).detach();
            "recalling"
        } else {
            let draw = c.draw.is_some() || (self.params.jackpot_epochs > 0 && c.epoch.id % self.params.jackpot_epochs == 0);
            if draw && !c.draw_done {
                let n = limit.unwrap_or(DEFAULT_BATCH).clamp(1, MAX_BATCH) as usize;
                c.draw_done = self.draw_jackpot(c.epoch.id, &mut c.draw, n);
                if !c.draw_done {
                    self.closing = Some(c);
                    return "drawing jackpot".into();
                }
            }
            self.pay(c);
            return "closed".into();
        };
        self.closing = Some(c);
        result.into()
    }

    /// The life contract's total still owed after expiry: the house mirrors it exactly.
    #[private]
    pub fn on_expired(&mut self, #[callback_result] owed: Result<U128, PromiseError>) -> bool {
        let Some(c) = self.closing.as_mut() else { return false };
        match owed {
            Ok(owed) => {
                self.lives_owed = owed.0;
                c.expired = true;
                true
            }
            Err(_) => {
                c.expiring = false; // try again on the next call
                false
            }
        }
    }

    /// If the Backer Life couldn't be minted, the backing is undone into the backer's free balance.
    #[private]
    pub fn on_backer_minted(&mut self, account_id: AccountId, amount: U128, cap_ppm: U128, oneup: U128, #[callback_result] r: Result<String, PromiseError>) -> bool {
        self.pending_backing -= amount.0;
        if r.is_err() {
            self.backer_oneup += oneup.0;
            self.credit(&account_id, amount.0);
            env::log_str("Backer Life mint failed; the backing is in your free balance");
            return false;
        }
        self.pool += amount.0;
        self.seed += amount.0;
        let owed = math::owed(amount.0, cap_ppm.0);
        self.lives_owed += owed;
        Event::Backed { account_id: account_id.clone(), amount, cap_ppm, owed: U128(owed), pool: U128(self.pool) }.emit();
        if cap_ppm.0 == math::PPM { Event::Seed { amount, pool: U128(self.pool) }.emit(); }
        self.lock_for_backer(account_id, oneup.0);
        true
    }

    #[private]
    pub fn on_pot(&mut self, amount: U128, #[callback_result] used: Result<U128, PromiseError>) -> bool {
        self.pending_pots = self.pending_pots.saturating_sub(1);
        let used = used.map_or(0, |x| x.0.min(amount.0));
        let back = amount.0 - used;
        // A partial refund may be rounding dust, and does not settle other outstanding lives.
        self.pool += back;
        self.lives_paid -= back;
        self.lives_owed += back;
        back == 0
    }

    pub fn get_epoch_summary(&self, epoch: u64) -> Option<EpochSummary> {
        self.epochs.get(&epoch).cloned()
    }

    pub fn get_closing(&self) -> Option<ClosingView> {
        self.closing.as_ref().map(|c| ClosingView {
            epoch: c.epoch.id,
            house_net: U128(c.house_net),
            cap_ppm: U128(c.cap_ppm),
            losers_left: c.losers.len(),
            lives_minted: c.lives_minted,
            pending_mints: c.pending_mints,
        })
    }

    pub fn get_lives_state(&self) -> LivesState {
        LivesState {
            life: self.life.clone(),
            lives_owed: U128(self.lives_owed),
            lives_paid: U128(self.lives_paid),
            buyback_usdc: U128(self.buyback_usdc),
        }
    }
}

impl House {
    fn begin_close(&mut self) {
        let now = now_s();
        require!(now >= self.epoch.started_at + self.params.epoch_length_s, "Epoch not over yet");
        let next = self.epoch.id + 1;
        let losers = std::mem::replace(
            &mut self.epoch_losses,
            IterableMap::new(StorageKey::EpochLosses { epoch: next }),
        );
        let finished = std::mem::replace(&mut self.epoch, Epoch { id: next, started_at: now, ..Default::default() });
        // trading's result plus the marketplace's cut (D-28)
        let house_net = (finished.losses.0 + finished.fees.0).saturating_sub(finished.payouts.0);
        // $1UP goes by the same base as the Lives' faces: house profit, at most the round's net losses
        let oneup_release = self.release_emissions(&finished, math::recovery_base(house_net, finished.net_losses.0));
        self.checkpoint_ve(next);
        self.closing = Some(Closing {
            house_net,
            cap_ppm: math::life_cap_ppm(self.pool),
            epoch: finished,
            ended_at: now,
            losers,
            lives_minted: 0,
            pending_mints: 0,
            expiring: false,
            expired: false,
            oneup_release,
            oneup_assigned: 0,
            recalling: false,
            draw: None,
            draw_done: false,
        });
    }

    /// USDC the round's payout needs back from the vault: the pool after the payout must still cover what's
    /// deployed, or the cash backing traders' balances would leave.
    pub(crate) fn recall_needed(&self) -> Option<u128> {
        if self.deployed == 0 {
            return None;
        }
        let p = math::epoch_payout(self.pool, self.liability, self.lives_owed, self.reserve_floor());
        let after = self.pool - p.lives_pot - p.buyback_pot;
        (self.deployed > after).then(|| self.deployed - after)
    }

    /// Mints a Backer Life (D-22). The caller has already counted what it's owed.
    pub(crate) fn mint_backer(&mut self, owner: AccountId, amount: u128, cap_ppm: u128, oneup: u128) -> Promise {
        let life = self.life.clone().unwrap_or_else(|| env::panic_str("Set the Extra Life contract first"));
        ext_life::ext(life)
            .with_static_gas(GAS_MINT_BASE.saturating_add(GAS_MINT_PER_LIFE))
            .mint_backer(owner.clone(), U128(amount), U128(cap_ppm))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(100)).on_backer_minted(owner, U128(amount), U128(cap_ppm), U128(oneup)))
    }

    fn pay(&mut self, c: Closing) {
        self.settle_release(c.epoch.id, c.oneup_release, c.oneup_assigned);
        let p = math::epoch_payout(self.pool, self.liability, self.lives_owed, self.reserve_floor());
        self.pool -= p.lives_pot + p.buyback_pot;
        self.buyback_usdc += p.buyback_pot;
        if p.buyback_pot > 0 {
            self.record_buyback(&c.epoch, p.buyback_pot);
        }
        if p.lives_pot > 0 {
            self.pending_pots += 1;
            self.lives_owed -= p.lives_pot;
            self.lives_paid += p.lives_pot;
            let msg = format!(r#"{{"epoch_pot":{{"epoch":{}}}}}"#, c.epoch.id);
            ext_ft::ext(self.usdc.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(GAS_FT_TRANSFER_CALL)
                .ft_transfer_call(self.life.clone().expect("life"), U128(p.lives_pot), None, msg)
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_POT_CALLBACK).on_pot(U128(p.lives_pot)))
                .detach();
        }
        let summary = EpochSummary {
            epoch: c.epoch.id,
            started_at: c.epoch.started_at,
            ended_at: c.ended_at,
            losses: c.epoch.losses,
            payouts: c.epoch.payouts,
            cuts: c.epoch.cuts,
            fees: c.epoch.fees,
            house_net: U128(c.house_net),
            cap_ppm: U128(c.cap_ppm),
            lives_minted: c.lives_minted,
            pool: U128(self.pool),
            reserve: U128(p.reserve),
            surplus: U128(p.surplus),
            lives_pot: U128(p.lives_pot),
            buyback_pot: U128(p.buyback_pot),
        };
        self.epochs.insert(c.epoch.id, summary.clone());
        Event::EpochClosed { summary }.emit();
    }
}
