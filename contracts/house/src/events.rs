use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

use crate::{EpochSummary, Side};

/// NEP-297 events, `standard: "oneup"`. The indexer (api/) builds history from these.
#[near(event_json(standard = "oneup"))]
pub enum Event {
    #[event_version("1.0.0")]
    Deposit { account_id: AccountId, amount: U128 },
    #[event_version("1.0.0")]
    Withdraw { account_id: AccountId, amount: U128 },
    #[event_version("1.0.0")]
    Seed { amount: U128, pool: U128 },
    #[event_version("1.0.0")]
    OrderPlaced { order_id: u64, account_id: AccountId, market_id: String, position_id: Option<u64> },
    #[event_version("1.0.0")]
    OrderExpired { order_id: u64, account_id: AccountId },
    #[event_version("1.0.0")]
    PositionOpened {
        position_id: u64,
        order_id: u64,
        account_id: AccountId,
        market_id: String,
        side: Side,
        margin: U128,
        leverage: u32,
        entry_price: U128,
        cut_ppm: U128,
    },
    #[event_version("1.0.0")]
    PositionClosed {
        position_id: u64,
        account_id: AccountId,
        market_id: String,
        reason: CloseReason,
        price: U128,
        pnl: String,
        cut: U128,
        payout: U128,
        pool: U128,
    },
    #[event_version("1.0.0")]
    EpochClosed { summary: EpochSummary },
    /// D-22: someone backed the pool and got a Backer Life owed `owed` (`cap_ppm` × the amount).
    #[event_version("1.0.0")]
    Backed { account_id: AccountId, amount: U128, cap_ppm: U128, owed: U128, pool: U128 },
    #[event_version("1.0.0")]
    TriggersSet { position_id: u64, account_id: AccountId, take_profit: Option<U128>, stop_loss: Option<U128> },
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloseReason {
    Close,
    Liquidation,
    /// The 9× profit cap.
    TakeProfit,
    /// The trader's take-profit price.
    Target,
    /// The trader's stop-loss price.
    Stop,
}
