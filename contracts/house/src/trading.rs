use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseError, PromiseOrValue};
use oneup_math as math;

use crate::events::{CloseReason, Event};
use crate::oracle::{ext_ft, ext_oracle, CheckedPrice, OraclePrice};
use crate::{now_s, House, HouseExt, Order, OrderKind, Position, Side, Triggers};

const GAS_ORACLE: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(40);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(10);

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
enum DepositMsg {
    Seed {},
    /// D-22: anyone backs the pool during the bootstrap round and gets a Backer Life.
    Back {},
    /// Deposit and place an open in one step; `margin` comes from the free balance after the deposit.
    /// From the NEAR Intents Verifier, `account_id` names whose trade it is (D-21).
    Open {
        market_id: String,
        side: Side,
        margin: U128,
        leverage: u32,
        #[serde(default)]
        take_profit: Option<U128>,
        #[serde(default)]
        stop_loss: Option<U128>,
        /// D-30: a limit order rather than one for the next price.
        #[serde(default)]
        limit_price: Option<U128>,
        #[serde(default)]
        account_id: Option<AccountId>,
    },
    /// From the NEAR Intents Verifier only: credit this account's free balance (D-21).
    For { account_id: AccountId },
    /// From the marketplace only: its cut of a sale, into the pool as house profit (D-28).
    MarketFee {},
}

#[near]
impl House {
    // Deposits and withdrawals

    /// USDC in. `msg = ""` credits the sender's free balance; `{"seed":{}}` from the owner and `{"back":{}}`
    /// from anyone add to the pool.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        if Some(&token) == self.oneup.as_ref() {
            // the owner funding backers' $1UP (D-26); anything else is a buyback's proceeds
            if msg == r#"{"fund_backers":{}}"# {
                require!(sender_id == self.owner, "Only the owner funds backers' $1UP");
                self.backer_oneup += amount.0;
                env::log_str(&format!("{} $1UP set aside for backers", amount.0));
                return PromiseOrValue::Value(U128(0));
            }
            return self.on_buyback_proceeds(sender_id, amount, msg);
        }
        require!(token == self.usdc, "Only USDC deposits");
        if msg.is_empty() {
            self.require_new_balance_min(&sender_id, amount.0);
            self.credit(&sender_id, amount.0);
            Event::Deposit { account_id: sender_id, amount }.emit();
        } else {
            let parsed: DepositMsg = near_sdk::serde_json::from_str(&msg)
                .unwrap_or_else(|_| env::panic_str("Unknown deposit message"));
            match parsed {
                DepositMsg::Seed {} => {
                    require!(sender_id == self.owner, "Only the owner seeds the pool");
                    // The seed's Backer Life is capped at 1.0×, so the seed is only ever paid back
                    self.back(sender_id, amount.0, math::PPM);
                    Event::Seed { amount, pool: U128(self.pool) }.emit();
                }
                DepositMsg::Back {} => {
                    require!(amount.0 >= math::MIN_BACKING, "Back with at least 10 USDC");
                    require!(self.seed + amount.0 <= self.params.backing_target.0, "Backing round is full");
                    let cap = math::backer_cap_ppm(self.pool, amount.0);
                    self.back(sender_id.clone(), amount.0, cap);
                    self.lock_for_backer(sender_id, amount.0);
                }
                DepositMsg::Open { market_id, side, margin, leverage, take_profit, stop_loss, limit_price, account_id } => {
                    require!(limit_price.is_none_or(|x| x.0 > 0), "Limit price must be above zero");
                    let triggers = Triggers { take_profit, stop_loss };
                    if self.from_intents(&sender_id) {
                        // the Verifier doesn't return tokens a receiver rejects, so never refuse: a
                        // refused open leaves the deposit in the trader's free balance
                        let who = account_id.unwrap_or_else(|| env::panic_str("Intents deposits name an account"));
                        self.require_new_balance_min(&who, amount.0);
                        self.credit(&who, amount.0);
                        Event::Deposit { account_id: who.clone(), amount }.emit();
                        let refusal = self.open_refusal(&market_id, side, margin.0, leverage, math::max_liability(margin.0));
                        match refusal {
                            // only the funds this deposit brought: the sender names the account, so it
                            // must not be able to trade someone else's balance
                            None if margin.0 > amount.0 => {
                                env::log_str("Order not placed: margin above the deposit; the deposit stays in the free balance")
                            }
                            None if self.balance_of(&who) >= margin.0 => {
                                self.internal_place_open(who, market_id, side, margin, leverage, triggers, limit_price);
                            }
                            None => env::log_str("Order not placed: margin above the free balance; the deposit stays there"),
                            Some(why) => env::log_str(&format!("Order not placed: {why}; the deposit stays in the free balance")),
                        }
                    } else {
                        require!(account_id.is_none(), "Only NEAR Intents deposits name an account");
                        // a refused open (capacity, leverage) panics, so the whole transfer is refunded
                        self.require_new_balance_min(&sender_id, amount.0);
                        self.credit(&sender_id, amount.0);
                        Event::Deposit { account_id: sender_id.clone(), amount }.emit();
                        self.internal_place_open(sender_id, market_id, side, margin, leverage, triggers, limit_price);
                    }
                }
                DepositMsg::MarketFee {} => {
                    require!(self.marketplace.as_ref() == Some(&sender_id), "Only the marketplace pays fees");
                    self.pool += amount.0;
                    self.epoch.fees.0 += amount.0;
                }
                DepositMsg::For { account_id } => {
                    require!(self.from_intents(&sender_id), "Only NEAR Intents deposits name an account");
                    self.require_new_balance_min(&account_id, amount.0);
                    self.credit(&account_id, amount.0);
                    Event::Deposit { account_id, amount }.emit();
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
    /// Optional take-profit and stop-loss prices go with the position once it fills.
    pub fn place_open(
        &mut self,
        market_id: String,
        side: Side,
        margin: U128,
        leverage: u32,
        take_profit: Option<U128>,
        stop_loss: Option<U128>,
    ) -> u64 {
        let triggers = Triggers { take_profit, stop_loss };
        self.internal_place_open(env::predecessor_account_id(), market_id, side, margin, leverage, triggers, None)
    }

    /// D-30: an open that rests until the price reaches `limit_price` (at or below it for a long, at or above
    /// for a short) on a price newer than the order, then fills at that price. Its margin and the house's room
    /// are held from now, as for any open, until it fills, is cancelled, or expires after `limit_expiry_s`.
    #[allow(clippy::too_many_arguments)]
    pub fn place_limit_open(
        &mut self,
        market_id: String,
        side: Side,
        margin: U128,
        leverage: u32,
        limit_price: U128,
        take_profit: Option<U128>,
        stop_loss: Option<U128>,
    ) -> u64 {
        require!(limit_price.0 > 0, "Limit price must be above zero");
        let triggers = Triggers { take_profit, stop_loss };
        self.internal_place_open(env::predecessor_account_id(), market_id, side, margin, leverage, triggers, Some(limit_price))
    }

    /// D-30: the trader takes a resting limit order down; its margin and the house's room come back. A market
    /// order can't be cancelled: it fills at the next price, and taking it back after seeing that price
    /// coming would be a free option on the house.
    pub fn cancel_order(&mut self, order_id: u64) {
        let order = self.orders.get(&order_id).unwrap_or_else(|| env::panic_str("No such order")).clone();
        require!(order.owner == env::predecessor_account_id(), "Not your order");
        let OrderKind::Open { side, margin, limit: Some(_), .. } = order.kind else {
            env::panic_str("Only a limit order can be cancelled")
        };
        self.orders.remove(&order_id);
        self.change_liability(&order.market_id, side, math::max_liability(margin.0), false);
        self.credit(&order.owner, margin.0);
        Event::OrderCancelled { order_id, account_id: order.owner }.emit();
    }

    /// Sets or clears a position's take-profit and stop-loss. They fire only on prices published after
    /// this call, so a trigger set across the current price can't close at a price the trader already knows.
    pub fn set_triggers(&mut self, position_id: u64, take_profit: Option<U128>, stop_loss: Option<U128>) {
        let account = env::predecessor_account_id();
        let p = self.positions.get_mut(&position_id).unwrap_or_else(|| env::panic_str("No such position"));
        require!(p.owner == account, "Not your position");
        require!(take_profit.is_none_or(|x| x.0 > 0) && stop_loss.is_none_or(|x| x.0 > 0), "Trigger prices must be above zero");
        p.triggers = Triggers { take_profit, stop_loss };
        p.triggers_set_at = now_s();
        Event::TriggersSet { position_id, account_id: account, take_profit, stop_loss }.emit();
    }
    pub fn place_close(&mut self, position_id: u64) -> u64 {
        let p = self.positions.get(&position_id).unwrap_or_else(|| env::panic_str("No such position"));
        require!(p.owner == env::predecessor_account_id(), "Not your position");
        require!(p.close_order.is_none(), "Close already pending");
        require!(now_s() >= p.opened_at + self.params.min_hold_s, "Minimum hold not reached");
        self.internal_place_close(position_id, CloseReason::Close, now_s())
    }

    /// The keeper (decision D-2). Fills at an oracle price published after the order, within the window.
    pub fn fill(&mut self, order_id: u64) -> Promise {
        self.assert_keeper();
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
        require!(now_s() > order.placed_at + self.window(&order), "Fill window still open");
        self.orders.remove(&order_id);
        match order.kind {
            OrderKind::Open { side, margin, .. } => {
                self.change_liability(&order.market_id, side, math::max_liability(margin.0), false);
                self.credit(&order.owner, margin.0);
            }
            OrderKind::Close { position_id, .. } => {
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

    /// The keeper: at the cap a newer price can't pay more, so this settles at the latest price.
    pub fn take_profit(&mut self, position_id: u64) -> Promise {
        self.assert_keeper();
        self.price_then(position_id, CloseReason::TakeProfit)
    }

    /// The trader's take-profit price was reached: places a close that fills at the next price (D-19).
    /// Anyone may call it; it only does what the trader asked for.
    pub fn hit_target(&mut self, position_id: u64) -> Promise {
        self.price_then(position_id, CloseReason::Target)
    }

    /// The trader's stop-loss price was reached: places a close that fills at the next price (D-19).
    pub fn hit_stop(&mut self, position_id: u64) -> Promise {
        self.price_then(position_id, CloseReason::Stop)
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
    fn from_intents(&self, sender_id: &AccountId) -> bool {
        self.intents.as_ref() == Some(sender_id)
    }

    fn balance_of(&self, account: &AccountId) -> u128 {
        self.balances.get(account).copied().unwrap_or(0)
    }

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
        if p.publish_time > order.placed_at + self.window(&order) {
            return Err("Price is past the fill window; expire the order");
        }
        if let OrderKind::Open { side, limit: Some(limit), .. } = order.kind {
            // D-30: a long fills at the limit or lower, a short at the limit or higher
            let reached = match side {
                Side::Long => p.price <= limit.0,
                Side::Short => p.price >= limit.0,
            };
            if !reached {
                return Err("Limit price not reached");
            }
        }
        self.orders.remove(&order_id);
        match order.kind {
            OrderKind::Open { side, margin, leverage, cut_ppm, triggers, .. } => {
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
                        triggers,
                        // the fill price is already newer than the order, so it may fire them (after the hold)
                        triggers_set_at: order.placed_at,
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
            OrderKind::Close { position_id, reason } => {
                // Liquidated or taken at cap while the close was pending: nothing left to do.
                if self.positions.contains_key(&position_id) {
                    self.close_position(position_id, p.price, reason);
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
        // the trader's own triggers wait out the minimum hold, like a close, and need a price newer than
        // when they were set
        let armed = now >= pos.opened_at + self.params.min_hold_s && p.publish_time > pos.triggers_set_at;
        let ok = match reason {
            CloseReason::Liquidation => math::is_liquidatable(pnl, pos.margin.0),
            CloseReason::TakeProfit => math::at_profit_cap(pnl, pos.margin.0),
            CloseReason::Target => armed && pos.triggers.take_profit.is_some_and(|t| math::target_hit(pos.side.into(), p.price, t.0)),
            CloseReason::Stop => armed && pos.triggers.stop_loss.is_some_and(|t| math::stop_hit(pos.side.into(), p.price, t.0)),
            CloseReason::Close => false,
        };
        if !ok {
            return Err("Position is not eligible");
        }
        match reason {
            // A trigger can be set at any price, so settling at the price that crossed it would let a
            // trader close whenever the on-chain price lags the market in their favour. It places a
            // close instead, filled at the next price like the trader's own.
            CloseReason::Target | CloseReason::Stop => {
                if pos.close_order.is_some() {
                    return Err("Close already pending");
                }
                self.internal_place_close(position_id, reason, now);
            }
            _ => self.close_position(position_id, p.price, reason),
        }
        Ok(())
    }

    fn internal_place_close(&mut self, position_id: u64, reason: CloseReason, now: u64) -> u64 {
        let id = self.take_id();
        let p = self.positions.get_mut(&position_id).expect("position");
        p.close_order = Some(id);
        let (owner, market_id) = (p.owner.clone(), p.market_id.clone());
        self.orders.insert(
            id,
            Order { id, owner: owner.clone(), market_id: market_id.clone(), kind: OrderKind::Close { position_id, reason }, placed_at: now },
        );
        Event::OrderPlaced { order_id: id, account_id: owner, market_id, position_id: Some(position_id) }.emit();
        id
    }

    /// A new free-balance entry costs the house storage, so it needs at least the minimum margin.
    fn require_new_balance_min(&self, account: &AccountId, amount: u128) {
        require!(self.balances.contains_key(account) || amount >= self.params.min_margin.0, "Deposit below the minimum");
    }

    /// Adds `amount` to the pool and the seed (so it only comes back from profit, D-12) and mints its
    /// Backer Life owed `cap_ppm` × `amount` (D-22).
    fn back(&mut self, account: AccountId, amount: u128, cap_ppm: u128) {
        self.pool += amount;
        self.seed += amount;
        let owed = math::owed(amount, cap_ppm);
        self.lives_owed += owed;
        self.mint_backer(account.clone(), amount, cap_ppm).detach();
        Event::Backed { account_id: account, amount: U128(amount), cap_ppm: U128(cap_ppm), owed: U128(owed), pool: U128(self.pool) }.emit();
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
        // Extra Lives go by each wallet's net loss, so a long and a short on yourself earn nothing extra
        let before = self.epoch_losses.get(&pos.owner).copied().unwrap_or(0);
        let after = before + s.pool_taken as i128 - s.pool_paid as i128;
        self.epoch_losses.insert(pos.owner.clone(), after);
        self.epoch.net_losses.0 = self.epoch.net_losses.0 + after.max(0) as u128 - before.max(0) as u128;
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
    /// How long an order may wait for its fill: the next price for a market order, longer for a limit (D-30).
    fn window(&self, order: &Order) -> u64 {
        match order.kind {
            OrderKind::Open { limit: Some(_), .. } => self.params.limit_expiry_s,
            _ => self.params.fill_window_s,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn internal_place_open(
        &mut self,
        account: AccountId,
        market_id: String,
        side: Side,
        margin: U128,
        leverage: u32,
        triggers: Triggers,
        limit: Option<U128>,
    ) -> u64 {
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
                kind: OrderKind::Open { side, margin, leverage, cut_ppm, triggers, limit },
                placed_at: now_s(),
            },
        );
        Event::OrderPlaced { order_id: id, account_id: account, market_id, position_id: None }.emit();
        id
    }
}
