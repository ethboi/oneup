//! $1UP for losers (D-16, maths §8).
//!
//! Each epoch releases `oneup_per_usdc` $1UP per USDC of house profit, capped by the epoch's schedule plus
//! anything unreleased before; the rest carries forward. The release is shared across the epoch's losers
//! by loss and arrives as max-length locks in `ve`, minted alongside the Extra Lives. Winners are paid in
//! USDC and earn no $1UP. The house holds the 900M emissions supply.

use near_sdk::json_types::U128;
use near_sdk::{env, ext_contract, near, AccountId, Gas, NearToken, Promise, PromiseError};
use oneup_math as math;

use crate::oracle::ext_ft;
use crate::{Epoch, House, HouseExt, MarketTotals};

const GAS_VE_CHECKPOINT: Gas = Gas::from_tgas(20);
const GAS_LOCKS_BASE: Gas = Gas::from_tgas(30);
const GAS_LOCK_EACH: Gas = Gas::from_tgas(6);
const GAS_LOCKS_CALLBACK: Gas = Gas::from_tgas(10);

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct EpochEmissions {
    pub epoch: u64,
    /// This epoch's share of the 4-year schedule.
    pub scheduled: U128,
    /// Released to this epoch's losers: `oneup_per_usdc` × house profit, at most schedule + carry.
    pub released: U128,
    /// Of the release, what landed in locks (rounding and failed transfers go back to the carry).
    pub locked: U128,
    /// Unreleased $1UP carried into the next epoch.
    pub carry: U128,
}

#[allow(dead_code)]
#[ext_contract(ext_ve)]
trait Ve {
    fn checkpoint(&mut self, epoch: u64);
}

#[near]
impl House {
    pub fn get_emissions(&self, epoch: u64) -> Option<EpochEmissions> {
        self.emissions.get(&epoch).cloned()
    }

    /// $1UP waiting to be released by future house profit.
    pub fn get_emission_carry(&self) -> U128 {
        U128(self.emission_carry)
    }

    /// After a `lock_for` transfer: anything `ve` didn't take goes back to the carry.
    #[private]
    pub fn on_locks(&mut self, epoch: u64, amount: U128, #[callback_result] used: Result<U128, PromiseError>) -> bool {
        if let Some(c) = self.closing.as_mut() {
            c.pending_mints = c.pending_mints.saturating_sub(1);
        }
        let used = used.map(|u| u.0).unwrap_or(0);
        if used == amount.0 {
            return true;
        }
        let back = amount.0 - used;
        self.emission_carry += back;
        if let Some(mut rec) = self.emissions.get(&epoch).cloned() {
            rec.locked.0 -= back;
            rec.carry.0 += back;
            self.emissions.insert(epoch, rec);
        }
        env::log_str(&format!("Loser locks failed; {back} $1UP back to the carry"));
        false
    }
}

impl House {
    /// Per-market totals for the epoch summary and the buyback.
    pub(crate) fn record_market_totals(&mut self, market_id: &str, s: math::Settlement) {
        let totals = match self.epoch.markets.iter_mut().find(|t| t.market_id == market_id) {
            Some(t) => t,
            None => {
                self.epoch.markets.push(MarketTotals { market_id: market_id.into(), ..Default::default() });
                self.epoch.markets.last_mut().unwrap()
            }
        };
        totals.losses.0 += s.pool_taken;
        totals.payouts.0 += s.pool_paid;
        totals.cuts.0 += s.cut;
    }

    /// At epoch close: how much $1UP this epoch's losers get. Without a token and `ve` nothing is released
    /// and the schedule carries.
    pub(crate) fn release_emissions(&mut self, epoch: &Epoch, house_net: u128) -> u128 {
        let scheduled = math::emissions_for_epoch(epoch.id);
        let available = self.emission_carry + scheduled;
        let release = if self.oneup.is_some() && self.ve.is_some() {
            math::released_emissions(available, house_net, self.params.oneup_per_usdc as u128)
        } else {
            0
        };
        self.emission_carry = available - release;
        self.emissions.insert(
            epoch.id,
            EpochEmissions {
                epoch: epoch.id,
                scheduled: U128(scheduled),
                released: U128(release),
                locked: U128(0),
                carry: U128(self.emission_carry),
            },
        );
        release
    }

    /// Sends a batch of losers' $1UP to `ve` as max-length locks.
    pub(crate) fn lock_for_losers(&mut self, epoch: u64, items: Vec<(AccountId, u128)>) -> Promise {
        let total: u128 = items.iter().map(|(_, a)| a).sum();
        if let Some(mut rec) = self.emissions.get(&epoch).cloned() {
            rec.locked.0 += total;
            self.emissions.insert(epoch, rec);
        }
        let items: Vec<(AccountId, U128)> = items.into_iter().map(|(o, a)| (o, U128(a))).collect();
        let gas = GAS_LOCKS_BASE.saturating_add(GAS_LOCK_EACH.saturating_mul(items.len() as u64));
        let msg = near_sdk::serde_json::json!({ "lock_for": { "items": items } }).to_string();
        ext_ft::ext(self.oneup.clone().expect("oneup"))
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(gas)
            .ft_transfer_call(self.ve.clone().expect("ve"), U128(total), None, msg)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_LOCKS_CALLBACK).on_locks(epoch, U128(total)))
    }

    /// Release not handed out (rounding across losers) goes back to the carry.
    pub(crate) fn settle_release(&mut self, epoch: u64, released: u128, assigned: u128) {
        let left = released - assigned;
        if left == 0 {
            return;
        }
        self.emission_carry += left;
        if let Some(mut rec) = self.emissions.get(&epoch).cloned() {
            rec.carry.0 += left;
            self.emissions.insert(epoch, rec);
        }
    }

    /// Fixes `ve`'s total lock weight for the new epoch.
    pub(crate) fn checkpoint_ve(&self, epoch: u64) {
        if let Some(ve) = self.ve.clone() {
            ext_ve::ext(ve).with_static_gas(GAS_VE_CHECKPOINT).checkpoint(epoch).detach();
        }
    }
}
