//! Gate 3 in the sandbox: trade → close epoch → emissions → vote → the vote sets next epoch's capacity.

mod common;
use common::*;
use near_workspaces::types::NearToken;
use serde_json::json;

const ONEUP: u128 = 1_000_000_000_000_000_000;

#[tokio::test]
async fn trade_vote_emissions_capacity() -> anyhow::Result<()> {
    let e = setup(5).await?;
    e.owner
        .call(e.house.id(), "add_market")
        .args_json(json!({"market_id": "BTC-USD", "feed_id": "btc", "max_leverage": 100}))
        .transact()
        .await?
        .into_result()?;

    // Alice locks 1_000 $1UP for 52 epochs and votes 70% BTC / 30% NEAR
    let alice = e.owner.create_subaccount("alice").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    register(&e.owner, &e.oneup, alice.id().as_str()).await?;
    e.owner
        .call(e.oneup.id(), "ft_transfer")
        .args_json(json!({"receiver_id": alice.id(), "amount": (1_000 * ONEUP).to_string()}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    alice
        .call(e.oneup.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": e.ve.id(), "amount": (1_000 * ONEUP).to_string(), "msg": "{\"lock\":{\"epochs\":52}}"}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let locks = view(&e.ve, "locks_for_owner", json!({"account_id": alice.id()})).await?;
    let lock_id = locks[0]["token_id"].as_str().unwrap().to_string();
    alice
        .call(e.ve.id(), "vote")
        .args_json(json!({"token_id": lock_id, "allocations": [["BTC-USD", "700000"], ["NEAR-USD", "300000"]]}))
        .transact()
        .await?
        .into_result()?;

    // Bob loses 500 on NEAR-USD in epoch 1 (no votes yet: markets share equally)
    let bob = trader(&e, "bob", 500).await?;
    register(&e.owner, &e.oneup, bob.id().as_str()).await?;
    let (pos, placed_at) = open(&e, &bob, "Long", 500, 50, 500).await?;
    push(&e, 490, placed_at + 2).await?;
    let ok: bool = e.keeper.call(e.house.id(), "liquidate").args_json(json!({"position_id": pos})).max_gas().transact().await?.json()?;
    assert!(ok);

    e.worker.fast_forward(10).await?;
    let steps = close_epoch(&e).await?;
    assert_eq!(steps.last().map(String::as_str), Some("closed"), "{steps:?}");

    // ve checkpointed epoch 2 and sent the shares back: they now set capacity
    assert_eq!(view(&e.ve, "get_epoch", json!({})).await?, json!(2));
    let shares = view(&e.house, "get_vote_shares", json!({})).await?;
    assert_eq!(shares, json!([["BTC-USD", "700000"], ["NEAR-USD", "300000"]]));
    let solvency = view(&e.house, "get_solvency", json!({})).await?;
    let pool: u128 = solvency["pool"].as_str().unwrap().parse()?;
    let near_cap: u128 = solvency["markets"].as_array().unwrap().iter().find(|m| m["id"] == "NEAR-USD").unwrap()["capacity"]
        .as_str()
        .unwrap()
        .parse()?;
    assert_eq!(near_cap, pool * 3 / 10);

    // Epoch-1 emissions: NEAR-USD had half (equal shares); with no winners Bob's loss earns all of it
    let per_epoch: u128 = 900_000_000 * ONEUP / 208;
    let claimable = view(&e.house, "get_claimable_emissions", json!({"account_id": bob.id(), "epochs": [1]})).await?;
    assert_eq!(claimable, json!((per_epoch / 2).to_string()));
    bob.call(e.house.id(), "claim_emissions").args_json(json!({"epochs": [1]})).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&e.oneup, "ft_balance_of", json!({"account_id": bob.id()})).await?, json!((per_epoch / 2).to_string()));
    // BTC-USD had no trades: its half went to the treasury
    assert_eq!(view(&e.house, "get_treasury_oneup", json!({})).await?, json!((per_epoch - per_epoch / 2).to_string()));
    Ok(())
}
