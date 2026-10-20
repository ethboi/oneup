//! $1UP emissions (maths §8) and vote shares from `ve`.
//!
//! Each epoch's emissions are split across markets by vote share, then within a market half to winners
//! by the cut they paid and half to losers by their losses (∝ Extra Life face value). The house holds the
//! 900M emissions supply and pays claims from it.

use near_sdk::json_types::U128;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, Promise, PromiseError};
use oneup_math as math;

use crate::oracle::ext_ft;
use crate::{Epoch, House, HouseExt, MarketTotals};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_CLAIM_CALLBACK: Gas = Gas::from_tgas(10);
const GAS_VE_CHECKPOINT: Gas = Gas::from_tgas(80);

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Activity {
    pub market_id: String,
    pub cut: U128,
    pub loss: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct MarketEmission {
    pub market_id: String,
    pub share_ppm: U128,
    /// $1UP for this market's winners (by cut) and losers (by loss).
    pub winners: U128,
    pub losers: U128,
    pub cuts: U128,
    pub losses: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct EpochEmissions {
    pub epoch: u64,
    pub total: U128,
    /// Extra Lives were minted, so losers earn.
    pub lives: bool,
    pub markets: Vec<MarketEmission>,
}

#[allow(dead_code)]
#[ext_contract(ext_ve)]
trait Ve {
    fn checkpoint(&mut self, epoch: u64);
}

#[near]
impl House {
    /// `ve` only: vote shares (ppm) for `epoch`. They set each market's capacity and its emission share.
    pub fn set_vote_shares(&mut self, epoch: u64, shares: Vec<(String, U128)>) {
        require!(Some(env::predecessor_account_id()) == self.ve, "Only ve");
        require!(epoch == self.epoch.id, "Shares are for another epoch");
        let shares: Vec<(String, U128)> = shares.into_iter().filter(|(m, _)| self.markets.contains_key(m)).collect();
        if !shares.is_empty() {
            for m in self.markets.values_mut() {
                m.capacity_ppm = shares.iter().find(|(id, _)| *id == m.id).map(|(_, s)| *s).unwrap_or(U128(0));
            }
        }
        self.vote_shares = shares;
    }

    /// Pays the caller's $1UP for the given (closed) epochs.
    pub fn claim_emissions(&mut self, epochs: Vec<u64>) -> Promise {
        let account = env::predecessor_account_id();
        let mut total = self.oneup_owed.remove(&account).unwrap_or(0);
        for e in epochs {
            let Some(rec) = self.emissions.get(&e).cloned() else { continue };
            if let Some(acts) = self.activity.remove(&(e, account.clone())) {
                total += earned(&rec, &acts);
            }
        }
        require!(total > 0, "Nothing to claim");
        self.send_oneup(account, total)
    }

    #[private]
    pub fn on_oneup_claim(&mut self, account_id: AccountId, amount: U128, #[callback_result] r: Result<(), PromiseError>) -> bool {
        if r.is_err() {
            let owed = self.oneup_owed.get(&account_id).copied().unwrap_or(0);
            self.oneup_owed.insert(account_id, owed + amount.0);
            return false;
        }
        true
    }

    pub fn treasury_withdraw(&mut self, receiver_id: AccountId, amount: U128) -> Promise {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        require!(amount.0 <= self.treasury_oneup, "More than the treasury holds");
        self.treasury_oneup -= amount.0;
        self.send_oneup(receiver_id, amount.0)
    }

    // Views

    pub fn get_emissions(&self, epoch: u64) -> Option<EpochEmissions> {
        self.emissions.get(&epoch).cloned()
    }

    pub fn get_vote_shares(&self) -> Vec<(String, U128)> {
        self.effective_shares()
    }

    pub fn get_activity(&self, account_id: AccountId, epoch: u64) -> Vec<Activity> {
        self.activity.get(&(epoch, account_id)).cloned().unwrap_or_default()
    }

    /// $1UP the account can claim now for these epochs (plus any owed from a failed claim).
    pub fn get_claimable_emissions(&self, account_id: AccountId, epochs: Vec<u64>) -> U128 {
        let mut total = self.oneup_owed.get(&account_id).copied().unwrap_or(0);
        for e in epochs {
            if let (Some(rec), Some(acts)) = (self.emissions.get(&e), self.activity.get(&(e, account_id.clone()))) {
                total += earned(rec, acts);
            }
        }
        U128(total)
    }

    pub fn get_treasury_oneup(&self) -> U128 {
        U128(self.treasury_oneup)
    }
}

fn earned(rec: &EpochEmissions, acts: &[Activity]) -> u128 {
    acts.iter()
        .filter_map(|a| rec.markets.iter().find(|m| m.market_id == a.market_id).map(|m| (a, m)))
        .map(|(a, m)| {
            math::pro_rata(m.winners.0, a.cut.0, m.cuts.0) + math::pro_rata(m.losers.0, a.loss.0, m.losses.0)
        })
        .sum()
}

impl House {
    pub(crate) fn record_activity(&mut self, owner: &AccountId, market_id: &str, s: math::Settlement) {
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
        if s.cut == 0 && s.pool_taken == 0 {
            return;
        }
        let key = (self.epoch.id, owner.clone());
        let mut acts = self.activity.get(&key).cloned().unwrap_or_default();
        match acts.iter_mut().find(|a| a.market_id == market_id) {
            Some(a) => {
                a.cut.0 += s.cut;
                a.loss.0 += s.pool_taken;
            }
            None => acts.push(Activity { market_id: market_id.into(), cut: U128(s.cut), loss: U128(s.pool_taken) }),
        }
        self.activity.insert(key, acts);
    }

    /// Vote shares in force; with no votes yet, live markets share equally.
    pub(crate) fn effective_shares(&self) -> Vec<(String, U128)> {
        if !self.vote_shares.is_empty() {
            return self.vote_shares.clone();
        }
        let live: Vec<String> = self.markets.values().filter(|m| m.live).map(|m| m.id.clone()).collect();
        let n = live.len() as u128;
        live.into_iter().map(|id| (id, U128(math::PPM / n.max(1)))).collect()
    }

    /// At epoch close: fixes the epoch's emission split. Market emissions nobody can earn go to the treasury.
    pub(crate) fn record_emissions(&mut self, epoch: &Epoch, lives: bool) {
        let total = math::emissions_for_epoch(epoch.id);
        let mut markets = vec![];
        let mut assigned = 0;
        for (market_id, share) in self.effective_shares() {
            let amount = total * share.0 / math::PPM;
            assigned += amount;
            let t = epoch.markets.iter().find(|t| t.market_id == market_id).cloned().unwrap_or_default();
            let has_winners = t.cuts.0 > 0;
            let has_losers = lives && t.losses.0 > 0;
            let (winners, losers) = match (has_winners, has_losers) {
                (true, true) => (amount / 2, amount - amount / 2),
                (true, false) => (amount, 0),
                (false, true) => (0, amount),
                (false, false) => {
                    self.treasury_oneup += amount;
                    (0, 0)
                }
            };
            markets.push(MarketEmission {
                market_id,
                share_ppm: share,
                winners: U128(winners),
                losers: U128(losers),
                cuts: t.cuts,
                losses: t.losses,
            });
        }
        self.treasury_oneup += total - assigned;
        self.emissions.insert(epoch.id, EpochEmissions { epoch: epoch.id, total: U128(total), lives, markets });
    }

    /// Asks `ve` for the new epoch's vote shares (it calls back `set_vote_shares`).
    pub(crate) fn checkpoint_ve(&self, epoch: u64) {
        if let Some(ve) = self.ve.clone() {
            ext_ve::ext(ve).with_static_gas(GAS_VE_CHECKPOINT).checkpoint(epoch).detach();
        }
    }

    fn send_oneup(&mut self, account: AccountId, amount: u128) -> Promise {
        let token = self.oneup.clone().unwrap_or_else(|| env::panic_str("No $1UP token set"));
        ext_ft::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account.clone(), U128(amount), None)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CLAIM_CALLBACK).on_oneup_claim(account, U128(amount)))
    }
}
