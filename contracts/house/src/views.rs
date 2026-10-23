use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};
use oneup_math as math;

use crate::{Epoch, House, HouseExt, Market, Order, Params, Position, Side};

#[near(serializers = [json])]
pub struct Backing {
    /// Total seeded and backed so far.
    pub backed: U128,
    pub target: U128,
    pub open: bool,
    pub min: U128,
    /// What the quoted amount would be owed, × 1e6, and in USDC.
    pub cap_ppm: U128,
    pub owed: U128,
    /// $1UP the quoted amount would be locked for its backer (D-26), and what's left of the allocation.
    pub oneup: U128,
    pub oneup_left: U128,
}

#[near(serializers = [json])]
pub struct MarketSolvency {
    pub id: String,
    pub long_liability: U128,
    pub short_liability: U128,
    pub liability: U128,
    pub capacity: U128,
}

#[near(serializers = [json])]
pub struct Solvency {
    pub pool: U128,
    /// Σ market liability: the worst case the pool must cover.
    pub liability: U128,
    pub reserve: U128,
    pub surplus: U128,
    /// The reserve's floor: the seed.
    pub seed: U128,
    pub both_sides: bool,
    pub markets: Vec<MarketSolvency>,
}

#[near(serializers = [json])]
pub struct Quote {
    pub allowed: bool,
    pub reason: Option<String>,
    pub cut_ppm: U128,
    pub max_profit: U128,
    /// At this price (1e8 units), if given.
    pub liquidation_price: Option<U128>,
}

#[near]
impl House {
    pub fn get_params(&self) -> Params {
        self.params.clone()
    }

    pub fn get_config(&self) -> (AccountId, AccountId, AccountId) {
        (self.owner.clone(), self.usdc.clone(), self.oracle.clone())
    }

    pub fn get_pool(&self) -> U128 {
        U128(self.pool)
    }

    pub fn get_balance(&self, account_id: AccountId) -> U128 {
        U128(self.balance(&account_id))
    }

    pub fn get_markets(&self) -> Vec<Market> {
        self.markets.values().cloned().collect()
    }

    pub fn get_position(&self, position_id: u64) -> Option<Position> {
        self.positions.get(&position_id).cloned()
    }

    pub fn get_positions(&self, account_id: AccountId) -> Vec<Position> {
        self.positions.values().filter(|p| p.owner == account_id).cloned().collect()
    }

    /// Every open position, paged. The keeper scans these for liquidations.
    pub fn list_positions(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Position> {
        let from = from_index.unwrap_or(0) as usize;
        self.positions.values().skip(from).take(limit.unwrap_or(100) as usize).cloned().collect()
    }

    pub fn get_orders(&self, account_id: AccountId) -> Vec<Order> {
        self.orders.values().filter(|o| o.owner == account_id).cloned().collect()
    }

    /// Every pending order, paged. The keeper fills these.
    pub fn list_orders(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Order> {
        let from = from_index.unwrap_or(0) as usize;
        self.orders.values().skip(from).take(limit.unwrap_or(100) as usize).cloned().collect()
    }

    pub fn get_epoch(&self) -> Epoch {
        self.epoch.clone()
    }

    /// Net loss so far this epoch (losses − profit paid): the wallet's pending Extra Life. Face value is
    /// set at epoch close.
    pub fn get_pending_life(&self, account_id: AccountId) -> U128 {
        U128(self.epoch_losses.get(&account_id).copied().unwrap_or(0).max(0) as u128)
    }

    /// The bootstrap round (D-22): how much is backed, the target, and what backing `amount` now earns.
    pub fn get_backing(&self, amount: Option<U128>) -> Backing {
        let amount = amount.map_or(math::USDC, |a| a.0.max(1));
        let cap_ppm = math::backer_cap_ppm(self.pool + self.pending_backing, amount);
        Backing {
            backed: U128(self.seed),
            target: self.params.backing_target,
            open: self.closing.is_none() && !self.closing_requested && self.seed + self.pending_backing + math::MIN_BACKING <= self.params.backing_target.0,
            min: U128(math::MIN_BACKING),
            cap_ppm: U128(cap_ppm),
            owed: U128(math::owed(amount, cap_ppm)),
            oneup: U128(self.backer_oneup_for(amount)),
            oneup_left: U128(self.backer_oneup),
        }
    }

    pub fn get_solvency(&self) -> Solvency {
        let markets = self
            .markets
            .values()
            .map(|m| MarketSolvency {
                id: m.id.clone(),
                long_liability: m.long_liability,
                short_liability: m.short_liability,
                liability: U128(self.market_liability(m)),
                capacity: U128(math::capacity(m.capacity_ppm.0, self.pool)),
            })
            .collect();
        let reserve = math::reserve(self.liability, self.reserve_floor());
        Solvency {
            pool: U128(self.pool),
            liability: U128(self.liability),
            reserve: U128(reserve),
            surplus: U128(self.pool.saturating_sub(reserve)),
            seed: U128(self.seed),
            both_sides: self.params.solvency_both_sides,
            markets,
        }
    }

    /// What `place_open` would do, without doing it.
    pub fn quote_open(
        &self,
        market_id: String,
        side: Side,
        margin: U128,
        leverage: u32,
        price: Option<U128>,
    ) -> Quote {
        let liability = math::max_liability(margin.0);
        let reason = self.open_refusal(&market_id, side, margin.0, leverage, liability);
        Quote {
            allowed: reason.is_none(),
            reason,
            cut_ppm: U128(math::cut_ppm(liability, self.pool)),
            max_profit: U128(liability),
            liquidation_price: price.map(|p| U128(math::liquidation_price(side.into(), p.0, leverage))),
        }
    }
}

impl House {
    /// The seed, or the spec's 25K before any seed.
    pub(crate) fn reserve_floor(&self) -> u128 {
        if self.seed > 0 { self.seed } else { math::MIN_RESERVE }
    }

    pub(crate) fn open_refusal(&self, market_id: &str, side: Side, margin: u128, leverage: u32, liability: u128) -> Option<String> {
        let m = match self.markets.get(market_id) {
            Some(m) => m,
            None => return Some("No such market".into()),
        };
        if !m.live {
            return Some("Market is not live".into());
        }
        if leverage < 1 || leverage > m.max_leverage {
            return Some("Leverage out of range".into());
        }
        if margin < self.params.min_margin.0 {
            return Some("Margin below minimum".into());
        }
        let (mut long, mut short) = (m.long_liability.0, m.short_liability.0);
        match side {
            Side::Long => long += liability,
            Side::Short => short += liability,
        }
        let both = self.params.solvency_both_sides;
        let before = self.market_liability(m);
        let after = math::market_liability(long, short, both);
        if after > before {
            if self.liability - before + after > self.pool {
                return Some("Pool can't cover this trade".into());
            }
            if after > math::capacity(m.capacity_ppm.0, self.pool) {
                return Some("Market capacity reached".into());
            }
        }
        None
    }
}
