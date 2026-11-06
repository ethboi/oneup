//! $1UP for losers (D-16, maths §8).
//!
//! Each epoch releases `oneup_per_usdc` $1UP per USDC of house profit (up to the epoch's net losses, like the
//! Lives' faces), capped by the epoch's schedule plus anything unreleased before; the rest carries forward. The release is shared across the epoch's losers
//! by loss and arrives as max-length locks in `ve`, minted alongside the Life NFTs. Winners are paid in
//! USDC and earn no $1UP. The house holds the 900M emissions supply.

use near_sdk::json_types::U128;
use near_sdk::{ext_contract, near, AccountId, Gas};
use oneup_math as math;

use crate::{Epoch, House, HouseExt, MarketTotals};

const GAS_VE_CHECKPOINT: Gas = Gas::from_tgas(20);

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct EpochEmissions {
    pub epoch: u64,
    /// This epoch's share of the 4-year schedule.
    pub scheduled: U128,
    /// Released to this epoch's losers: `oneup_per_usdc` × house profit, at most schedule + carry.
    pub released: U128,
    /// Of the release, what is confirmed in locks. Failed receipts retain the original recipient entitlement.
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

    /// $1UP owed a backer for `usdc` backed (D-26): the rate, capped by what's left of the allocation.
    pub(crate) fn backer_oneup_for(&self, usdc: u128) -> u128 {
        if self.oneup.is_none() || self.ve.is_none() {
            return 0;
        }
        // USDC has 6 decimals and $1UP 18
        (usdc * self.params.backer_oneup_per_usdc as u128 * 1_000_000_000_000).min(self.backer_oneup)
    }

    /// Reserves a durable backer lock. Failed transfers remain owed to this backer.
    pub(crate) fn lock_for_backer(&mut self, account: AccountId, amount: u128) {
        if amount == 0 { return; }
        self.pending_backer_locks += 1;
        self.queue_recovery(self.epoch.id, self.epoch.id, vec![], vec![(account, amount)], false);
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
