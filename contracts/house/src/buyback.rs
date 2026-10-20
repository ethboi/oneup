//! Buybacks (maths §7): each epoch's buyback USDC is swapped for $1UP and sent to `ve`, split by each
//! market's house profit, for that epoch's voters of the market.
//!
//! close_epoch records the USDC and the split → `buyback(epoch)` sends it to the swap → the swap pays the
//! $1UP back with `{"buyback_proceeds":{"epoch":e}}` → the house forwards it to `ve`.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PromiseError, PromiseOrValue};
use oneup_math as math;

use crate::oracle::ext_ft;
use crate::{Epoch, House, HouseExt};

const GAS_SWAP: Gas = Gas::from_tgas(150);
const GAS_SWAP_CALLBACK: Gas = Gas::from_tgas(15);
const GAS_FORWARD: Gas = Gas::from_tgas(60);

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BuybackStatus {
    Pending,
    Swapping,
    Done,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Buyback {
    pub epoch: u64,
    pub usdc: U128,
    /// ppm per market: positive house profit, or vote shares if no market made any.
    pub weights: Vec<(String, U128)>,
    pub status: BuybackStatus,
    pub oneup: U128,
}

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
enum ProceedsMsg {
    BuybackProceeds { epoch: u64 },
}

#[near]
impl House {
    /// Swaps an epoch's buyback USDC. Owner only for now: `min_out` sets the worst acceptable price, and a
    /// permissionless call would let anyone pass 0 and sandwich the swap (decision D-10).
    pub fn buyback(&mut self, epoch: u64, min_out: U128) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        let swap = self.swap.clone().unwrap_or_else(|| env::panic_str("No swap set"));
        let b = self.buybacks.get_mut(&epoch).unwrap_or_else(|| env::panic_str("No buyback for epoch"));
        require!(b.status == BuybackStatus::Pending, "Buyback not pending");
        b.status = BuybackStatus::Swapping;
        let usdc = b.usdc;
        let msg = near_sdk::serde_json::json!({"swap": {
            "min_out": min_out,
            "receiver_id": env::current_account_id(),
            "msg": format!(r#"{{"buyback_proceeds":{{"epoch":{epoch}}}}}"#),
        }})
        .to_string();
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_SWAP)
            .ft_transfer_call(swap, usdc, None, msg)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_SWAP_CALLBACK).on_buyback_sent(epoch, usdc))
            .detach();
    }

    #[private]
    pub fn on_buyback_sent(&mut self, epoch: u64, amount: U128, #[callback_result] used: Result<U128, PromiseError>) -> bool {
        let used = used.map(|u| u.0).unwrap_or(0);
        let b = self.buybacks.get_mut(&epoch).expect("buyback");
        if used == amount.0 {
            self.buyback_usdc -= amount.0;
            return true;
        }
        // Refused (e.g. min_out): the USDC came back; try again later.
        b.status = BuybackStatus::Pending;
        false
    }

    pub fn get_buyback(&self, epoch: u64) -> Option<Buyback> {
        self.buybacks.get(&epoch).cloned()
    }
}

impl House {
    pub(crate) fn record_buyback(&mut self, epoch: &Epoch, usdc: u128) {
        let profits: Vec<(String, u128)> = epoch
            .markets
            .iter()
            .map(|t| (t.market_id.clone(), t.losses.0.saturating_sub(t.payouts.0)))
            .filter(|(_, p)| *p > 0)
            .collect();
        let total: u128 = profits.iter().map(|(_, p)| p).sum();
        let weights = if total > 0 {
            profits.into_iter().map(|(m, p)| (m, U128(p * math::PPM / total))).collect()
        } else {
            self.effective_shares()
        };
        self.buybacks.insert(
            epoch.id,
            Buyback { epoch: epoch.id, usdc: U128(usdc), weights, status: BuybackStatus::Pending, oneup: U128(0) },
        );
    }

    /// $1UP from the swap: split by the epoch's weights and forward to `ve` for that epoch's voters.
    pub(crate) fn on_buyback_proceeds(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(Some(&sender_id) == self.swap.as_ref(), "Only swap proceeds");
        let ProceedsMsg::BuybackProceeds { epoch } =
            near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Bad proceeds message"));
        let b = self.buybacks.get_mut(&epoch).unwrap_or_else(|| env::panic_str("No buyback for epoch"));
        require!(b.status == BuybackStatus::Swapping, "Buyback not swapping");
        b.status = BuybackStatus::Done;
        b.oneup = amount;
        let mut per_market: Vec<(String, U128)> = vec![];
        let mut left = amount.0;
        let n = b.weights.len();
        for (i, (m, w)) in b.weights.iter().enumerate() {
            let a = if i + 1 == n { left } else { amount.0 * w.0 / math::PPM };
            left -= a;
            per_market.push((m.clone(), U128(a)));
        }
        let ve = self.ve.clone().unwrap_or_else(|| env::panic_str("No ve set"));
        let msg = near_sdk::serde_json::json!({"buyback": {"epoch": epoch, "per_market": per_market}}).to_string();
        ext_ft::ext(self.oneup.clone().expect("oneup"))
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FORWARD)
            .ft_transfer_call(ve, amount, None, msg)
            .detach();
        PromiseOrValue::Value(U128(0))
    }
}
