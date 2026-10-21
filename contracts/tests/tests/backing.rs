//! Sandbox: backing the pool for a Backer Life (D-22), fills only by the keeper, and a trigger that places a
//! close for the next price instead of settling at one the trader already saw (D-19 after the security
//! review).

mod common;
use common::*;
use near_workspaces::types::NearToken;
use serde_json::json;

async fn now_s(e: &Env) -> anyhow::Result<u64> {
    Ok(e.worker.view_block().await?.timestamp() / 1_000_000_000)
}

#[tokio::test]
async fn back_the_pool_then_trade_with_a_keeper() -> anyhow::Result<()> {
    let e = setup(600).await?;
    e.owner.call(e.house.id(), "set_keeper").args_json(json!({"keeper": e.keeper.id()})).transact().await?.into_result()?;

    // Bob backs the 100K pool with 10K: owed the curve's average over 100K → 110K, 1.916×
    let bob = e.owner.create_subaccount("bob").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    bob.call(e.usdc.id(), "faucet").args_json(json!({"amount": usd(10_000)})).transact().await?.into_result()?;
    transfer_call(&bob, &e.usdc, e.house.id().as_str(), usd(10_000), r#"{"back":{}}"#).await?;
    let b = view(&e.house, "get_backing", json!({})).await?;
    assert_eq!(b["backed"], json!(usd(110_000)));
    assert_eq!(view(&e.house, "get_pool", json!({})).await?, json!(usd(110_000)));
    let life = view(&e.life, "life_info", json!({"token_id": "b2"})).await?;
    assert_eq!(life["owner_id"], json!(bob.id()));
    assert_eq!(life["backer"], json!(true));
    assert_eq!(life["cap_ppm"], json!("1916000"));
    assert_eq!(life["owed"], json!(usd(19_160)));

    // Alice can't fill her own order (she'd pick the price); the keeper can
    let alice = trader(&e, "alice", 1_000).await?;
    let order: u64 = alice
        .call(e.house.id(), "place_open")
        .args_json(json!({"market_id": "NEAR-USD", "side": "Long", "margin": usd(100), "leverage": 10}))
        .transact()
        .await?
        .json()?;
    let t = now_s(&e).await?;
    push(&e, 500, t + 1).await?;
    let own = alice.call(e.house.id(), "fill").args_json(json!({"order_id": order})).max_gas().transact().await?;
    assert!(format!("{:?}", own.into_result()).contains("Only the keeper"));
    let ok: bool = e.keeper.call(e.house.id(), "fill").args_json(json!({"order_id": order})).max_gas().transact().await?.json()?;
    assert!(ok);
    let pos = view(&e.house, "get_positions", json!({"account_id": alice.id()})).await?[0]["id"].as_u64().unwrap();

    // After the hold, a stop at u128::MAX: a hit only places a close, filled by a newer price
    let opened = view(&e.house, "get_position", json!({"position_id": pos})).await?["opened_at"].as_u64().unwrap();
    while now_s(&e).await? < opened + 62 {
        e.worker.fast_forward(50).await?;
    }
    alice
        .call(e.house.id(), "set_triggers")
        .args_json(json!({"position_id": pos, "stop_loss": u128::MAX.to_string()}))
        .transact()
        .await?
        .into_result()?;
    let t = now_s(&e).await?;
    push(&e, 520, t + 1).await?;
    let r = e.owner.call(e.house.id(), "hit_stop").args_json(json!({"position_id": pos})).max_gas().transact().await?;
    let logs = r.logs().join("; ");
    let hit: bool = r.json()?;
    assert!(hit, "{logs} (now {})", now_s(&e).await?);
    let p = view(&e.house, "get_position", json!({"position_id": pos})).await?;
    let close = p["close_order"].as_u64().expect("a close was placed");
    // the price on chain when it was hit can't fill it
    let early: bool = e.keeper.call(e.house.id(), "fill").args_json(json!({"order_id": close})).max_gas().transact().await?.json()?;
    assert!(!early);
    let t = now_s(&e).await?;
    push(&e, 505, t + 1).await?;
    let ok: bool = e.keeper.call(e.house.id(), "fill").args_json(json!({"order_id": close})).max_gas().transact().await?.json()?;
    assert!(ok);
    assert!(view(&e.house, "get_position", json!({"position_id": pos})).await?.is_null());
    // settled at 5.05 (+1% × 10 = +10 less the cut), not 5.20 (+4% = +40)
    let bal: u128 = view(&e.house, "get_balance", json!({"account_id": alice.id()})).await?.as_str().unwrap().parse()?;
    assert!(bal > 1_000 * USDC && bal < 1_010 * USDC, "{bal}");
    Ok(())
}
