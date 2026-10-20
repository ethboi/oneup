//! Sandbox test of the real wasm: USDC deposit, oracle-priced fills across contracts, liquidation, withdraw.
//! Build first: `./build.sh`.

mod common;
use common::*;
use near_workspaces::types::NearToken;
use serde_json::json;

#[tokio::test]
async fn open_fill_liquidate_withdraw() -> anyhow::Result<()> {
    let e = setup(600).await?;
    assert_eq!(view(&e.house, "get_pool", json!({})).await?, json!(usd(100_000)));

    let t = trader(&e, "trader", 1_000).await?;
    assert_eq!(view(&e.house, "get_balance", json!({"account_id": t.id()})).await?, json!(usd(1_000)));

    // Open 500 USDC long at 50x
    let order: u64 = t
        .call(e.house.id(), "place_open")
        .args_json(json!({"market_id": "NEAR-USD", "side": "Long", "margin": usd(500), "leverage": 50}))
        .transact()
        .await?
        .into_result()?
        .json()?;
    let orders = view(&e.house, "get_orders", json!({"account_id": t.id()})).await?;
    let placed_at = orders[0]["placed_at"].as_u64().unwrap();

    // A price from before the order can't fill it
    push(&e, 500, placed_at).await?;
    let filled: bool = e.keeper.call(e.house.id(), "fill").args_json(json!({"order_id": order})).max_gas().transact().await?.json()?;
    assert!(!filled);

    // The next price can
    push(&e, 500, placed_at + 1).await?;
    let filled: bool = e.keeper.call(e.house.id(), "fill").args_json(json!({"order_id": order})).max_gas().transact().await?.json()?;
    assert!(filled);
    let positions = view(&e.house, "get_positions", json!({"account_id": t.id()})).await?;
    assert_eq!(positions[0]["entry_price"], json!("500000000"));
    let position_id = positions[0]["id"].as_u64().unwrap();

    // Not liquidatable at 4.95; liquidatable at 4.91 (−1.8% × 50 = −90%)
    push(&e, 495, placed_at + 2).await?;
    let ok: bool = e.keeper.call(e.house.id(), "liquidate").args_json(json!({"position_id": position_id})).max_gas().transact().await?.json()?;
    assert!(!ok);
    push(&e, 491, placed_at + 3).await?;
    let ok: bool = e.keeper.call(e.house.id(), "liquidate").args_json(json!({"position_id": position_id})).max_gas().transact().await?.json()?;
    assert!(ok);

    assert_eq!(view(&e.house, "get_pool", json!({})).await?, json!(usd(100_500)));
    assert_eq!(view(&e.house, "get_pending_life", json!({"account_id": t.id()})).await?, json!(usd(500)));

    // Withdraw the other 500
    t.call(e.house.id(), "withdraw")
        .args_json(json!({"amount": usd(500)}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    assert_eq!(view(&e.house, "get_balance", json!({"account_id": t.id()})).await?, json!("0"));
    assert_eq!(view(&e.usdc, "ft_balance_of", json!({"account_id": t.id()})).await?, json!(usd(500)));
    Ok(())
}
