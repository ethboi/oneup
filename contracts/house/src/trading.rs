use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseError, PromiseOrValue};
use oneup_math as math;

use crate::events::{CloseReason, Event};
use crate::oracle::{ext_ft, ext_oracle, CheckedPrice, OraclePrice};
use crate::{now_s, House, HouseExt, Order, OrderKind, Position, Side};

const GAS_ORACLE: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(40);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(10);

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
enum DepositMsg {
    Seed {},
    /// Deposit and place an open in one step; `margin` comes from the free balance after the deposit.
    Open { market_id: String, side: Side, margin: U128, leverage: u32 },
}

#[near]
impl House {
    // Deposits and withdrawals

    /// USDC in. `msg = ""` credits the sender's free balance; `{"seed":{}}` from the owner adds to the pool.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        if Some(&token) == self.oneup.as_ref() {
            return self.on_buyback_proceeds(sender_id, amount, msg);
        }
        require!(token == self.usdc, "Only USDC deposits");
        if msg.is_empty() {
            self.credit(&sender_id, amount.0);
            Event::Deposit { account_id: sender_id, amount }.emit();
        } else {
            let parsed: DepositMsg = near_sdk::serde_json::from_str(&msg)
                .unwrap_or_else(|_| env::panic_str("Unknown deposit message"));
            match parsed {
                DepositMsg::Seed {} => {
                    require!(sender_id == self.owner, "Only the owner seeds the pool");
                    self.pool += amount.0;
                    self.seed += amount.0;
                    // The seed provider's Extra Life: 1.0× cap, so the seed is paid back like any claim.
                    self.mint_lives(0, vec![(sender_id.clone(), amount.0, math::PPM)], false).detach();
                    Event::Seed { amount, pool: U128(self.pool) }.emit();
                }
                DepositMsg::Open { market_id, side, margin, leverage } => {
                    // a refused open (capacity, leverage) panics, so the whole transfer is refunded
                    self.credit(&sender_id, amount.0);
                    Event::Deposit { account_id: sender_id.clone(), amount }.emit();
                    self.internal_place_open(sender_id, market_id, side, margin, leverage);
                }
            }
        }
        PromiseOrValue::Value(U128(0))
    }

    #[payable]
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        near_sdk::assert_one_yocto();
        let account = env::predecessor_account_id();
        require!(amount.0 > 0, "Nothing to withdraw");
        self.debit(&account, amount.0);
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account.clone(), amount, None)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_WITHDRAW_CALLBACK).on_withdraw(account, amount))
    }

    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, amount: U128, #[callback_result] result: Result<(), PromiseError>) -> bool {
        if result.is_err() {
            self.credit(&account_id, amount.0);
            return false;
        }
        Event::Withdraw { account_id, amount }.emit();
        true
    }

    // Orders

    /// Moves `margin` from the free balance into a pending open. The solvency rule and the market's
    /// capacity are checked now, with the order counted, so the fill can't be refused for room.
    pub fn place_open(&mut self, market_id: String, side: Side, margin: U128, leverage: u32) -> u64 {
        self.internal_place_open(env::predecessor_account_id(), market_id, side, margin, leverage)
    }
    pub fn place_close(&mut self, position_id: u64) -> u64 {
        let account = env::predecessor_account_id();
        let now = now_s();
        let min_hold = self.params.min_hold_s;
        let id = self.next_id;
        let p = self.positions.get_mut(&position_id).unwrap_or_else(|| env::panic_str("No such position"));
        require!(p.owner == account, "Not your position");
        require!(p.close_order.is_none(), "Close already pending");
        require!(now >= p.opened_at + min_hold, "Minimum hold not reached");
        p.close_order = Some(id);
        let market_id = p.market_id.clone();
        self.next_id += 1;
        self.orders.insert(
            id,
            Order { id, owner: account.clone(), market_id: market_id.clone(), kind: OrderKind::Close { position_id }, placed_at: now },
        );
        Event::OrderPlaced { order_id: id, account_id: account, market_id, position_id: Some(position_id) }.emit();
        id
    }

    /// Anyone (keeper). Fills at the first oracle price published after the order (maths §2).
    pub fn fill(&mut self, order_id: u64) -> Promise {
        let order = self.orders.get(&order_id).unwrap_or_else(|| env::panic_str("No such order"));
        let feed = self.market(&order.market_id).feed_id.clone();
        ext_oracle::ext(self.oracle.clone())
            .with_static_gas(GAS_ORACLE)
            .get_price_unsafe(feed)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_fill(order_id))
    }

    #[private]
    pub fn on_fill(&mut self, order_id: u64, #[callback_result] price: Result<Option<OraclePrice>, PromiseError>) -> bool {
        log_result(self.internal_fill(order_id, price.ok().flatten(), now_s()))
    }

    /// Anyone, once the fill window has passed without a fill. Returns the margin or reopens the position.
    pub fn expire(&mut self, order_id: u64) {
        let order = self.orders.get(&order_id).unwrap_or_else(|| env::panic_str("No such order")).clone();
        require!(now_s() > order.placed_at + self.params.fill_window_s, "Fill window still open");
        self.orders.remove(&order_id);
        match order.kind {
            OrderKind::Open { side, margin, .. } => {
                self.change_liability(&order.market_id, side, math::max_liability(margin.0), false);
                self.credit(&order.owner, margin.0);
            }
            OrderKind::Close { position_id } => {
                if let Some(p) = self.positions.get_mut(&position_id) {
                    p.close_order = None;
                }
            }
        }
        Event::OrderExpired { order_id, account_id: order.owner }.emit();
    }

    // Keeper actions on open positions, at the latest valid price

    pub fn liquidate(&mut self, position_id: u64) -> Promise {
        self.price_then(position_id, CloseReason::Liquidation)
    }

    pub fn take_profit(&mut self, position_id: u64) -> Promise {
        self.price_then(position_id, CloseReason::TakeProfit)
    }

    #[private]
    pub fn on_keeper_price(
        &mut self,
        position_id: u64,
        reason: CloseReason,
        #[callback_result] price: Result<Option<OraclePrice>, PromiseError>,
    ) -> bool {
        log_result(self.internal_keeper_close(position_id, reason, price.ok().flatten(), now_s()))
    }
}

fn log_result(r: Result<(), &'static str>) -> bool {
    match r {
        Ok(()) => true,
        Err(e) => {
            env::log_str(e);
            false
        }
    }
}

impl House {
    fn price_then(&mut self, position_id: u64, reason: CloseReason) -> Promise {
        let p = self.positions.get(&position_id).unwrap_or_else(|| env::panic_str("No such position"));
        let feed = self.market(&p.market_id).feed_id.clone();
        ext_oracle::ext(self.oracle.clone())
            .with_static_gas(GAS_ORACLE)
            .get_price_unsafe(feed)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_keeper_price(position_id, reason))
    }

    fn checked(&self, price: Option<OraclePrice>, now: u64) -> Result<CheckedPrice, &'static str> {
        price
            .ok_or("No oracle price")?
            .check(now, self.params.max_price_age_s, self.params.max_conf_ppm.0)
    }

    pub(crate) fn internal_fill(&mut self, order_id: u64, price: Option<OraclePrice>, now: u64) -> Result<(), &'static str> {
        let order = self.orders.get(&order_id).ok_or("No such order")?.clone();
        let p = self.checked(price, now)?;
        if p.publish_time <= order.placed_at {
            return Err("Price is not newer than the order");
        }
        if p.publish_time > order.placed_at + self.params.fill_window_s {
            return Err("Price is past the fill window; expire the order");
        }
        self.orders.remove(&order_id);
        match order.kind {
            OrderKind::Open { side, margin, leverage, cut_ppm } => {
                let id = self.take_id();
                self.positions.insert(
                    id,
                    Position {
                        id,
                        owner: order.owner.clone(),
                        market_id: order.market_id.clone(),
                        side,
                        margin,
                        leverage,
                        entry_price: U128(p.price),
                        entry_publish_time: p.publish_time,
                        opened_at: now,
                        cut_ppm,
                        close_order: None,
                    },
                );
                Event::PositionOpened {
                    position_id: id,
                    order_id,
                    account_id: order.owner,
                    market_id: order.market_id,
                    side,
                    margin,
                    leverage,
                    entry_price: U128(p.price),
                    cut_ppm,
                }
                .emit();
            }
            OrderKind::Close { position_id } => {
                // Liquidated or taken at cap while the close was pending: nothing left to do.
                if self.positions.contains_key(&position_id) {
                    self.close_position(position_id, p.price, CloseReason::Close);
                }
            }
        }
        Ok(())
    }

    pub(crate) fn internal_keeper_close(
        &mut self,
        position_id: u64,
        reason: CloseReason,
        price: Option<OraclePrice>,
        now: u64,
    ) -> Result<(), &'static str> {
        let pos = self.positions.get(&position_id).ok_or("No such position")?;
        let p = self.checked(price, now)?;
        if p.publish_time < pos.entry_publish_time {
            return Err("Price older than the entry");
        }
        let pnl = math::pnl(pos.side.into(), pos.margin.0, pos.leverage, pos.entry_price.0, p.price);
        let ok = match reason {
            CloseReason::Liquidation => math::is_liquidatable(pnl, pos.margin.0),
            CloseReason::TakeProfit => math::at_profit_cap(pnl, pos.margin.0),
            CloseReason::Close => false,
        };
        if !ok {
            return Err("Position is not eligible");
        }
        self.close_position(position_id, p.price, reason);
        Ok(())
    }

    /// Settles a position at `price`: pays the trader's free balance, moves the pool, frees the liability
    /// and records the epoch's losses and payouts.
    pub(crate) fn close_position(&mut self, position_id: u64, price: u128, reason: CloseReason) {
        let pos = self.positions.remove(&position_id).expect("position");
        if let Some(order_id) = pos.close_order {
            self.orders.remove(&order_id);
        }
        let margin = pos.margin.0;
        let pnl = math::pnl(pos.side.into(), margin, pos.leverage, pos.entry_price.0, price);
        let s = match reason {
            CloseReason::Liquidation => math::settle_liquidation(margin),
            _ => math::settle(margin, pnl, pos.cut_ppm.0),
        };
        self.change_liability(&pos.market_id, pos.side, math::max_liability(margin), false);
        // Under D-1 the pool always covers this; under the spec's bigger-side rule it may not.
        self.pool = (self.pool + s.pool_taken)
            .checked_sub(s.pool_paid)
            .unwrap_or_else(|| env::panic_str("Pool can't cover this payout"));
        self.credit(&pos.owner, s.to_trader);

        self.epoch.losses.0 += s.pool_taken;
        self.epoch.payouts.0 += s.pool_paid;
        self.epoch.cuts.0 += s.cut;
        if s.pool_taken > 0 {
            let l = self.epoch_losses.get(&pos.owner).copied().unwrap_or(0);
            self.epoch_losses.insert(pos.owner.clone(), l + s.pool_taken);
        }
        self.record_market_totals(&pos.market_id, s);

        Event::PositionClosed {
            position_id,
            account_id: pos.owner,
            market_id: pos.market_id,
            reason,
            price: U128(price),
            pnl: if reason == CloseReason::Liquidation { (-(margin as i128)).to_string() } else { pnl.to_string() },
            cut: U128(s.cut),
            payout: U128(s.to_trader),
            pool: U128(self.pool),
        }
        .emit();
    }
}

impl House {
    pub(crate) fn internal_place_open(&mut self, account: AccountId, market_id: String, side: Side, margin: U128, leverage: u32) -> u64 {
        let m = self.market(&market_id);
        require!(m.live, "Market is not live");
        require!(leverage >= 1 && leverage <= m.max_leverage, "Leverage out of range");
        require!(margin.0 >= self.params.min_margin.0, "Margin below minimum");
        self.debit(&account, margin.0);
        let liability = math::max_liability(margin.0);
        self.change_liability(&market_id, side, liability, true);
        let cut_ppm = U128(math::cut_ppm(liability, self.pool));
        let id = self.take_id();
        self.orders.insert(
            id,
            Order {
                id,
                owner: account.clone(),
                market_id: market_id.clone(),
                kind: OrderKind::Open { side, margin, leverage, cut_ppm },
                placed_at: now_s(),
            },
        );
        Event::OrderPlaced { order_id: id, account_id: account, market_id, position_id: None }.emit();
        id
    }
}
