//! The OneUp house: one USDC pool every trade is against, at the oracle price.
//! Formulas live in `oneup-math` (docs/maths.md); this crate holds state and the rules around it.

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};
use oneup_math as math;

mod buyback;
mod emissions;
mod epochs;
mod events;
mod oracle;
mod recovery;
mod trading;
mod treasury;
mod views;

#[cfg(test)]
mod tests;

pub use buyback::{Buyback, BuybackStatus};
pub use emissions::EpochEmissions;
pub use epochs::{Closing, EpochSummary};
pub use events::{CloseReason, Event};
pub use oracle::OraclePrice;

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Long,
    Short,
}

impl From<Side> for math::Side {
    fn from(s: Side) -> Self {
        match s {
            Side::Long => math::Side::Long,
            Side::Short => math::Side::Short,
        }
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Params {
    /// Hard ceiling for any market's max leverage.
    pub leverage_hard_limit: u32,
    pub min_margin: U128,
    pub min_hold_s: u64,
    /// A fill must use a price published within this many seconds after the order (D-2).
    pub fill_window_s: u64,
    pub max_price_age_s: u64,
    pub max_conf_ppm: U128,
    /// D-1: count both sides of each market (true) or only the bigger side (spec as written).
    pub solvency_both_sides: bool,
    pub epoch_length_s: u64,
    /// D-13: an Extra Life shares the pots of the epoch it's minted in and this many after, then expires.
    pub life_expiry_epochs: u64,
    /// D-14: the share of the pool a newly listed market may use (ppm).
    pub market_capacity_ppm: U128,
    /// D-16: $1UP released to losers per USDC of house profit.
    pub oneup_per_usdc: u32,
    /// D-22: anyone may back the pool until the total seeded reaches this.
    #[serde(default = "default_backing_target")]
    pub backing_target: U128,
    /// D-26: $1UP locked for a backer per USDC backed, from the allocation the owner funds.
    #[serde(default = "default_backer_oneup")]
    pub backer_oneup_per_usdc: u32,
    /// D-27: the share of the pool always kept on hand, besides 1.2 × the worst case (ppm).
    #[serde(default = "default_float")]
    pub float_ppm: U128,
    /// D-27: the jackpot is drawn at the close of every this-many rounds.
    #[serde(default = "default_jackpot_epochs")]
    pub jackpot_epochs: u64,
    /// D-30: how long a limit order may rest, holding its margin and the house's room, before anyone can expire it.
    #[serde(default = "default_limit_expiry")]
    pub limit_expiry_s: u64,
}

fn default_limit_expiry() -> u64 {
    24 * 3600
}

fn default_float() -> U128 {
    U128(100_000)
}

fn default_jackpot_epochs() -> u64 {
    4
}

fn default_backing_target() -> U128 {
    U128(math::LIFE_CAP_POOL)
}

fn default_backer_oneup() -> u32 {
    10
}

impl Default for Params {
    fn default() -> Self {
        Self {
            // D-31: a position's max win is 9× its margin at any leverage, so the cap only sets how small a move
            // liquidates (0.09% at 1000×)
            leverage_hard_limit: 1000,
            min_margin: U128(math::USDC),
            min_hold_s: 60,
            fill_window_s: 30,
            max_price_age_s: 60,
            max_conf_ppm: U128(10_000),
            solvency_both_sides: true,
            epoch_length_s: 7 * 24 * 3600,
            life_expiry_epochs: 13,
            market_capacity_ppm: U128(500_000),
            oneup_per_usdc: math::ONEUP_PER_USDC as u32,
            backing_target: default_backing_target(),
            backer_oneup_per_usdc: default_backer_oneup(),
            float_ppm: default_float(),
            jackpot_epochs: default_jackpot_epochs(),
            limit_expiry_s: default_limit_expiry(),
        }
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Market {
    pub id: String,
    /// Pyth feed id, hex without `0x`.
    pub feed_id: String,
    pub max_leverage: u32,
    pub live: bool,
    /// Σ 9 × margin over open longs (and pending long opens).
    pub long_liability: U128,
    pub short_liability: U128,
    /// Share of the pool this market may use, ppm (D-14).
    pub capacity_ppm: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub enum OrderKind {
    /// `limit`: a limit order (D-30). It rests until a price at or better than the limit, newer than the order,
    /// or until `limit_expiry_s`; without one it fills at the next price within `fill_window_s`.
    Open { side: Side, margin: U128, leverage: u32, cut_ppm: U128, triggers: Triggers, limit: Option<U128> },
    /// `reason` is Close for the trader's own close, Target or Stop when a trigger placed it (D-19).
    Close { position_id: u64, reason: CloseReason },
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Order {
    pub id: u64,
    pub owner: AccountId,
    pub market_id: String,
    pub kind: OrderKind,
    /// Block time in seconds.
    pub placed_at: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Position {
    pub id: u64,
    pub owner: AccountId,
    pub market_id: String,
    pub side: Side,
    pub margin: U128,
    pub leverage: u32,
    /// 1e8 price units.
    pub entry_price: U128,
    /// Oracle publish time of the entry price; later actions need a price at least this new.
    pub entry_publish_time: u64,
    pub opened_at: u64,
    pub cut_ppm: U128,
    pub close_order: Option<u64>,
    pub triggers: Triggers,
    /// Block time (s) the triggers were last set; only prices published after it can fire them.
    pub triggers_set_at: u64,
}

/// Take-profit and stop-loss prices (1e8 units). When the oracle price crosses one, the keeper places a
/// close that fills at the next price, like the trader's own close (decision D-19).
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Triggers {
    pub take_profit: Option<U128>,
    pub stop_loss: Option<U128>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct Epoch {
    pub id: u64,
    pub started_at: u64,
    /// Σ losses taken by the pool from closes in this epoch (liquidations count the full margin).
    pub losses: U128,
    /// Σ profit paid out after the cut.
    pub payouts: U128,
    pub cuts: U128,
    /// Σ over wallets of max(0, losses − profit paid): what the epoch's Extra Lives and $1UP are shared by.
    pub net_losses: U128,
    pub markets: Vec<MarketTotals>,
    /// D-28: the house's cut of marketplace sales, counted as house profit.
    pub fees: U128,
}

/// One market's results in an epoch.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct MarketTotals {
    pub market_id: String,
    pub losses: U128,
    pub payouts: U128,
    pub cuts: U128,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Balances,
    Markets,
    Orders,
    Positions,
    EpochLosses { epoch: u64 },
    Epochs,
    Emissions,
    Buybacks,
    Tickets,
    RecoveryBatches,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct House {
    owner: AccountId,
    usdc: AccountId,
    oracle: AccountId,
    params: Params,
    /// House-owned USDC. Trader balances and margins are never part of it.
    pool: u128,
    /// Total seeded. The reserve never goes below it, so the seed is only repaid from profit.
    seed: u128,
    /// Σ market liability (maths §3), kept in step with the markets.
    liability: u128,
    balances: LookupMap<AccountId, u128>,
    markets: IterableMap<String, Market>,
    orders: IterableMap<u64, Order>,
    positions: IterableMap<u64, Position>,
    next_id: u64,
    epoch: Epoch,
    /// Each wallet's losses minus profit paid in the current epoch; above zero, its pending Extra Life.
    epoch_losses: IterableMap<AccountId, i128>,
    /// The Extra Life NFT contract.
    life: Option<AccountId>,
    /// Σ still owed to Extra Lives (mirrors the life contract's total).
    lives_owed: u128,
    /// USDC sent to the life contract as epoch pots.
    lives_paid: u128,
    /// Buyback USDC set aside from surplus, waiting to be swapped for $1UP (stage 4).
    buyback_usdc: u128,
    closing: Option<Closing>,
    epochs: LookupMap<u64, EpochSummary>,
    /// $1UP token and ve contracts.
    oneup: Option<AccountId>,
    ve: Option<AccountId>,
    emissions: LookupMap<u64, EpochEmissions>,
    /// Scheduled $1UP not yet released by house profit (D-16).
    emission_carry: u128,
    /// USDC → $1UP swap (Rhea on mainnet, `mock-swap` on testnet).
    swap: Option<AccountId>,
    buybacks: LookupMap<u64, Buyback>,
    /// May run buybacks besides the owner (D-20).
    operator: Option<AccountId>,
    /// The NEAR Intents Verifier: deposits it delivers may name the account they're for (D-21).
    intents: Option<AccountId>,
    /// Fills orders and fires take-profits and triggers. None = anyone may (tests, a keeperless setup).
    keeper: Option<AccountId>,
    /// $1UP the owner set aside for backers' locks (D-26), not yet handed out.
    backer_oneup: u128,
    /// D-27: the yield vault, the pool USDC in it, the jackpot its interest builds, and this period's tickets.
    vault: Option<AccountId>,
    deployed: u128,
    jackpot: u128,
    tickets: IterableMap<AccountId, u128>,
    tickets_total: u128,
    /// D-28: the marketplace whose sales pay the house a cut.
    marketplace: Option<AccountId>,
    /// Backing capital is unavailable for trading until its Backer Life mint succeeds.
    pending_backing: u128,
    pending_backer_locks: u32,
    pending_pots: u32,
    closing_requested: bool,
    recovery_batches: IterableMap<u64, recovery::RecoveryBatch>,
    next_recovery_batch: u64,
}

pub(crate) fn now_s() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

#[near]
impl House {
    #[init]
    pub fn new(owner: AccountId, usdc: AccountId, oracle: AccountId, params: Option<Params>) -> Self {
        Self {
            owner,
            usdc,
            oracle,
            params: params.unwrap_or_default(),
            pool: 0,
            seed: 0,
            liability: 0,
            balances: LookupMap::new(StorageKey::Balances),
            markets: IterableMap::new(StorageKey::Markets),
            orders: IterableMap::new(StorageKey::Orders),
            positions: IterableMap::new(StorageKey::Positions),
            next_id: 1,
            epoch: Epoch { id: 1, started_at: now_s(), ..Default::default() },
            epoch_losses: IterableMap::new(StorageKey::EpochLosses { epoch: 1 }),
            life: None,
            lives_owed: 0,
            lives_paid: 0,
            buyback_usdc: 0,
            closing: None,
            epochs: LookupMap::new(StorageKey::Epochs),
            oneup: None,
            ve: None,
            emissions: LookupMap::new(StorageKey::Emissions),
            emission_carry: 0,
            swap: None,
            buybacks: LookupMap::new(StorageKey::Buybacks),
            operator: None,
            intents: None,
            keeper: None,
            backer_oneup: 0,
            vault: None,
            deployed: 0,
            jackpot: 0,
            tickets: IterableMap::new(StorageKey::Tickets),
            tickets_total: 0,
            marketplace: None,
            pending_backing: 0,
            pending_backer_locks: 0,
            pending_pots: 0,
            closing_requested: false,
            recovery_batches: IterableMap::new(StorageKey::RecoveryBatches),
            next_recovery_batch: 1,
        }
    }

    /// The NEAR Intents Verifier whose deposits may credit another account (D-21). The owner only.
    pub fn set_intents(&mut self, intents: Option<AccountId>) {
        self.assert_owner();
        self.intents = intents;
    }

    /// Hands the house to a new owner, e.g. a Sputnik DAO (decision D-20). The current owner only.
    pub fn set_owner(&mut self, owner: AccountId) {
        self.assert_owner();
        self.owner = owner;
    }

    /// The operator runs routine buybacks, so a DAO owner doesn't vote on each one. The owner only.
    pub fn set_operator(&mut self, operator: Option<AccountId>) {
        self.assert_owner();
        self.operator = operator;
    }

    pub fn get_owner(&self) -> (AccountId, Option<AccountId>) {
        (self.owner.clone(), self.operator.clone())
    }

    /// Only the keeper fills orders and fires take-profits and triggers, so a trader can't choose the
    /// moment, and so the price, they settle at. Liquidations stay open to anyone. The owner only.
    pub fn set_keeper(&mut self, keeper: Option<AccountId>) {
        self.assert_owner();
        self.keeper = keeper;
    }

    pub fn get_keeper(&self) -> Option<AccountId> {
        self.keeper.clone()
    }

    // Admin. The owner lists markets (D-14).

    pub fn add_market(&mut self, market_id: String, feed_id: String, max_leverage: u32) {
        self.assert_owner();
        require!(!self.markets.contains_key(&market_id), "Market exists");
        require!(
            (1..=self.params.leverage_hard_limit).contains(&max_leverage),
            "Leverage above hard limit"
        );
        self.markets.insert(
            market_id.clone(),
            Market {
                id: market_id,
                feed_id,
                max_leverage,
                live: true,
                long_liability: U128(0),
                short_liability: U128(0),
                capacity_ppm: self.params.market_capacity_ppm,
            },
        );
    }

    pub fn set_market_live(&mut self, market_id: String, live: bool) {
        self.assert_owner();
        self.market_mut(&market_id).live = live;
    }

    /// D-31: the owner (the DAO) changes a market's leverage cap, up to the hard limit. Open positions keep
    /// theirs; only new opens are checked against it.
    pub fn set_max_leverage(&mut self, market_id: String, max_leverage: u32) {
        self.assert_owner();
        require!((1..=self.params.leverage_hard_limit).contains(&max_leverage), "Leverage above hard limit");
        self.market_mut(&market_id).max_leverage = max_leverage;
    }

    pub fn set_capacity(&mut self, market_id: String, capacity_ppm: U128) {
        self.assert_owner();
        require!(capacity_ppm.0 <= math::PPM, "Capacity above 100%");
        self.market_mut(&market_id).capacity_ppm = capacity_ppm;
    }

    pub fn set_life(&mut self, life: AccountId) {
        self.assert_owner();
        self.assert_reward_configuration_idle();
        self.life = Some(life);
    }

    pub fn set_token_and_ve(&mut self, oneup: AccountId, ve: AccountId) {
        self.assert_owner();
        self.assert_reward_configuration_idle();
        self.oneup = Some(oneup);
        self.ve = Some(ve);
    }

    pub fn set_swap(&mut self, swap: AccountId) {
        self.assert_owner();
        self.swap = Some(swap);
    }

    pub fn set_oracle(&mut self, oracle: AccountId) {
        self.assert_owner();
        self.oracle = oracle;
    }

    pub fn set_params(&mut self, params: Params) {
        self.assert_owner();
        require!(
            params.solvency_both_sides == self.params.solvency_both_sides || (self.positions.is_empty() && self.orders.is_empty()),
            "Change the solvency rule only with no open positions or orders"
        );
        self.params = params;
    }
}

impl House {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
    }

    pub(crate) fn assert_keeper(&self) {
        if let Some(k) = &self.keeper {
            let caller = env::predecessor_account_id();
            require!(&caller == k || caller == self.owner || self.operator.as_ref() == Some(&caller), "Only the keeper");
        }
    }

    pub(crate) fn market(&self, id: &str) -> &Market {
        self.markets.get(id).unwrap_or_else(|| env::panic_str("No such market"))
    }

    pub(crate) fn market_mut(&mut self, id: &str) -> &mut Market {
        self.markets.get_mut(id).unwrap_or_else(|| env::panic_str("No such market"))
    }

    pub(crate) fn market_liability(&self, m: &Market) -> u128 {
        math::market_liability(m.long_liability.0, m.short_liability.0, self.params.solvency_both_sides)
    }

    pub(crate) fn balance(&self, account: &AccountId) -> u128 {
        self.balances.get(account).copied().unwrap_or(0)
    }

    pub(crate) fn credit(&mut self, account: &AccountId, amount: u128) {
        if amount > 0 {
            let b = self.balance(account);
            self.balances.insert(account.clone(), b + amount);
        }
    }

    pub(crate) fn debit(&mut self, account: &AccountId, amount: u128) {
        let b = self.balance(account);
        require!(b >= amount, "Not enough free balance");
        self.balances.insert(account.clone(), b - amount);
    }

    /// Adds or removes a position's max liability. Additions are checked against the solvency rule
    /// and the market's capacity; removals never are (closes are never refused).
    pub(crate) fn change_liability(&mut self, market_id: &str, side: Side, amount: u128, add: bool) {
        let both = self.params.solvency_both_sides;
        let pool = self.pool;
        let m = self.markets.get_mut(market_id).unwrap_or_else(|| env::panic_str("No such market"));
        let before = math::market_liability(m.long_liability.0, m.short_liability.0, both);
        let slot = match side {
            Side::Long => &mut m.long_liability,
            Side::Short => &mut m.short_liability,
        };
        slot.0 = if add { slot.0 + amount } else { slot.0 - amount };
        let after = math::market_liability(m.long_liability.0, m.short_liability.0, both);
        let capacity = math::capacity(m.capacity_ppm.0, pool);
        self.liability = self.liability - before + after;
        if add && after > before {
            require!(self.liability <= pool, "Pool can't cover this trade");
            require!(after <= capacity, "Market capacity reached");
        }
    }

    pub(crate) fn take_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }
}

impl House {
    fn assert_reward_configuration_idle(&self) {
        require!(self.closing.is_none() && self.pending_backing == 0 && self.pending_pots == 0
            && self.recovery_batches.is_empty(), "Rewards pending: receiver configuration is frozen");
    }
}
