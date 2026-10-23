//! The house's money at work (D-27): pool USDC above what it must keep on hand sits in a yield vault (a mock
//! on localnet; a USDC lending market on Ethereum through NEAR Intents and a Chain Signatures account on
//! mainnet). Its interest builds a jackpot, drawn every `jackpot_epochs` rounds among that period's losers: each
//! dollar of net loss is a ticket.
//!
//! On hand, always: 1.2 × the worst-case payout of open positions plus `float_ppm` of the pool. Winners are paid
//! by crediting balances, so what must be cash is what can be withdrawn; before a round's payout leaves, the
//! close recalls whatever it needs (epochs.rs).

use near_sdk::json_types::U128;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, Promise, PromiseError};
use oneup_math as math;

use crate::events::Event;
use crate::oracle::ext_ft;
use crate::{House, HouseExt};

const GAS_VAULT: Gas = Gas::from_tgas(30);
const GAS_DEPLOY: Gas = Gas::from_tgas(60);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);

#[allow(dead_code)]
#[ext_contract(ext_vault)]
trait Vault {
    fn withdraw(&mut self, amount: U128);
    fn withdraw_interest(&mut self) -> U128;
}

#[near(serializers = [json])]
pub struct Treasury {
    pub vault: Option<AccountId>,
    /// Pool USDC in the vault.
    pub deployed: U128,
    /// The most that may be in the vault right now.
    pub deployable: U128,
    pub jackpot: U128,
    pub tickets: U128,
    /// The round whose close draws the jackpot.
    pub draw_epoch: u64,
}

#[near(serializers = [borsh])]
pub struct DrawProgress {
    pub target: u128,
    pub cumulative: u128,
    pub total: u128,
    pub amount: u128,
    pub winner: Option<(AccountId, u128)>,
}

#[near]
impl House {
    /// Owner: the marketplace whose sales pay the house a cut (D-28).
    pub fn set_marketplace(&mut self, marketplace: AccountId) {
        self.assert_owner();
        self.marketplace = Some(marketplace);
    }

    /// Owner: the yield vault (D-27).
    pub fn set_vault(&mut self, vault: AccountId) {
        self.assert_owner();
        self.vault = Some(vault);
    }

    /// Keeper: puts `amount` of the pool to work, up to what may be deployed.
    pub fn deploy(&mut self, amount: U128) -> Promise {
        self.assert_keeper();
        let vault = self.vault.clone().unwrap_or_else(|| env::panic_str("No vault"));
        require!(amount.0 > 0 && self.deployed + amount.0 <= self.deployable(), "More than may be deployed");
        self.deployed += amount.0;
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_DEPLOY)
            .ft_transfer_call(vault, amount, None, String::new())
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_deployed(amount))
    }

    /// Anyone: brings `amount` of the deployed USDC home (the keeper does when more must be on hand).
    pub fn recall(&mut self, amount: U128) -> Promise {
        require!(amount.0 > 0 && amount.0 <= self.deployed, "More than is deployed");
        self.recall_from_vault(amount.0, false)
    }

    /// Anyone: brings the vault's interest home into the jackpot.
    pub fn harvest(&mut self) -> Promise {
        let vault = self.vault.clone().unwrap_or_else(|| env::panic_str("No vault"));
        ext_vault::ext(vault)
            .with_static_gas(GAS_VAULT.saturating_mul(2))
            .withdraw_interest()
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_harvested())
    }

    #[private]
    pub fn on_deployed(&mut self, amount: U128, #[callback_result] used: Result<U128, PromiseError>) {
        // ft_transfer_call returns what the vault kept; anything refunded is back on hand
        let kept = used.map_or(0, |u| u.0.min(amount.0));
        self.deployed -= amount.0 - kept;
    }

    #[private]
    pub fn on_recalled(&mut self, amount: U128, for_close: bool, #[callback_result] r: Result<(), PromiseError>) -> bool {
        if for_close {
            if let Some(c) = self.closing.as_mut() {
                c.recalling = false;
            }
        }
        if r.is_err() {
            env::log_str("Recall failed; still deployed");
            return false;
        }
        self.deployed -= amount.0.min(self.deployed);
        true
    }

    #[private]
    pub fn on_harvested(&mut self, #[callback_result] got: Result<U128, PromiseError>) -> U128 {
        let amount = got.map_or(0, |a| a.0);
        self.jackpot += amount;
        U128(amount)
    }

    pub fn get_treasury(&self) -> Treasury {
        Treasury {
            vault: self.vault.clone(),
            deployed: U128(self.deployed),
            deployable: U128(self.deployable()),
            jackpot: U128(self.jackpot),
            tickets: U128(self.tickets_total),
            draw_epoch: self.draw_epoch(),
        }
    }

    /// An account's jackpot tickets this period ($1 of net loss = 1 ticket, in USDC units).
    pub fn get_tickets(&self, account_id: AccountId) -> U128 {
        U128(self.tickets.get(&account_id).copied().unwrap_or(0))
    }
}

impl House {
    /// What may be in the vault: the pool less 1.2 × the worst case and the float.
    pub(crate) fn deployable(&self) -> u128 {
        let keep = math::mul_div_ceil(self.liability, math::RESERVE_PPM, math::PPM) + math::mul_div_ceil(self.pool, self.params.float_ppm.0, math::PPM);
        self.pool.saturating_sub(keep)
    }

    pub(crate) fn recall_from_vault(&mut self, amount: u128, for_close: bool) -> Promise {
        let vault = self.vault.clone().unwrap_or_else(|| env::panic_str("No vault"));
        ext_vault::ext(vault)
            .with_static_gas(GAS_VAULT)
            .withdraw(U128(amount))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_recalled(U128(amount), for_close))
    }

    pub(crate) fn add_tickets(&mut self, account: &AccountId, loss: u128) {
        *self.tickets.entry(account.clone()).or_insert(0) += loss;
        self.tickets_total += loss;
    }

    /// The close of round `draw_epoch()` draws the jackpot.
    pub(crate) fn draw_epoch(&self) -> u64 {
        let n = self.params.jackpot_epochs.max(1);
        (self.epoch.id + n - 1) / n * n
    }

    /// Draws the jackpot among this period's tickets, from the block's random seed, and credits the winner.
    /// With no tickets (or no jackpot) it rolls over.
    pub(crate) fn draw_jackpot(&mut self, epoch: u64, progress: &mut Option<DrawProgress>, limit: usize) -> bool {
        if progress.is_none() {
            if self.jackpot == 0 || self.tickets_total == 0 {
                Event::JackpotRolled { epoch, jackpot: U128(self.jackpot) }.emit();
                return true;
            }
            let seed = env::random_seed();
            *progress = Some(DrawProgress {
                target: u128::from_le_bytes(seed[..16].try_into().unwrap()) % self.tickets_total,
                cumulative: 0, total: self.tickets_total,
                amount: std::mem::take(&mut self.jackpot), winner: None,
            });
        }
        let draw = progress.as_mut().expect("draw initialized");
        let batch: Vec<_> = self.tickets.iter().take(limit).map(|(a, t)| (a.clone(), *t)).collect();
        for (account, tickets) in batch {
            draw.cumulative += tickets;
            if draw.winner.is_none() && draw.target < draw.cumulative { draw.winner = Some((account.clone(), tickets)); }
            self.tickets.remove(&account);
        }
        if !self.tickets.is_empty() { return false; }
        let (account, tickets) = draw.winner.clone().expect("a ticket wins");
        self.credit(&account, draw.amount);
        Event::JackpotWon { epoch, account_id: account, amount: U128(draw.amount), tickets: U128(tickets), total_tickets: U128(draw.total) }.emit();
        self.tickets_total = 0;
        true
    }
}
