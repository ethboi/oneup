//! Gate 4 in the sandbox: a memecoin market is proposed and voted live; a NEAR-USD loss becomes a
//! buyback swapped to $1UP and paid to NEAR-USD's voters.

mod common;
use common::*;
use near_workspaces::types::NearToken;
use serde_json::json;

const ONEUP: u128 = 1_000_000_000_000_000_000;

fn oneup(x: u128) -> String {
    (x * ONEUP).to_string()
}

#[tokio::test]
async fn listing_and_buyback_to_voters() -> anyhow::Result<()> {
    let e = setup(5).await?;

    // Swap liquidity: 100K USDC / 10M $1UP (the owner holds the Rhea seed allocation)
    e.owner.call(e.usdc.id(), "mint").args_json(json!({"receiver_id": e.owner.id(), "amount": usd(100_000)})).transact().await?.into_result()?;
    transfer_call(&e.owner, &e.usdc, e.swap.id().as_str(), usd(100_000), r#"{"add_liquidity":{}}"#).await?;
    transfer_call(&e.owner, &e.oneup, e.swap.id().as_str(), oneup(10_000_000), r#"{"add_liquidity":{}}"#).await?;

    // Alice votes NEAR-USD with 9_800; Bob votes the proposed MEME-USD with 200 (2%)
    let mut locks = vec![];
    for (name, amount, market) in [("alice", 9_800, "NEAR-USD"), ("bob", 200, "MEME-USD")] {
        let a = e.owner.create_subaccount(name).initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
        register(&e.owner, &e.oneup, a.id().as_str()).await?;
        transfer(&e.owner, &e.oneup, a.id().as_str(), oneup(amount)).await?;
        transfer_call(&a, &e.oneup, e.ve.id().as_str(), oneup(amount), r#"{"lock":{"epochs":52}}"#).await?;
        let id = view(&e.ve, "locks_for_owner", json!({"account_id": a.id()})).await?[0]["token_id"].as_str().unwrap().to_string();
        a.call(e.ve.id(), "vote").args_json(json!({"token_id": id, "allocations": [[market, "1000000"]]})).transact().await?.into_result()?;
        locks.push((a, id));
    }
    let project = e.owner.create_subaccount("project").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    project.call(e.usdc.id(), "faucet").args_json(json!({"amount": usd(500)})).transact().await?.into_result()?;
    transfer_call(&project, &e.usdc, e.ve.id().as_str(), usd(500), r#"{"propose":{"market_id":"MEME-USD","feed_id":"meme"}}"#).await?;
    assert_eq!(view(&e.usdc, "ft_balance_of", json!({"account_id": project.id()})).await?, json!("0"));

    // Epoch 1 closes → checkpoint(2): MEME-USD has 2% → listed, bond back, capacity from votes
    e.worker.fast_forward(10).await?;
    close_epoch(&e).await?;
    let markets = view(&e.house, "get_markets", json!({})).await?;
    assert!(markets.as_array().unwrap().iter().any(|m| m["id"] == "MEME-USD"), "{markets}");
    assert_eq!(view(&e.usdc, "ft_balance_of", json!({"account_id": project.id()})).await?, json!(usd(500)));
    assert_eq!(view(&e.house, "get_vote_shares", json!({})).await?, json!([["MEME-USD", "20000"], ["NEAR-USD", "980000"]]));

    // Epoch 2: Carol loses 500 on NEAR-USD
    let carol = trader(&e, "carol", 500).await?;
    let (pos, placed_at) = open(&e, &carol, "Long", 500, 50, 500).await?;
    push(&e, 490, placed_at + 2).await?;
    let ok: bool = e.keeper.call(e.house.id(), "liquidate").args_json(json!({"position_id": pos})).max_gas().transact().await?.json()?;
    assert!(ok);
    e.worker.fast_forward(10).await?;
    close_epoch(&e).await?;

    // The epoch-2 buyback: all NEAR-USD profit → swap → ve
    let bb = view(&e.house, "get_buyback", json!({"epoch": 2})).await?;
    assert_eq!(bb["weights"], json!([["NEAR-USD", "1000000"]]));
    let usdc: u128 = bb["usdc"].as_str().unwrap().parse()?;
    let quote: String = view(&e.swap, "get_quote", json!({"usdc_in": usdc.to_string()})).await?.as_str().unwrap().into();
    e.owner.call(e.house.id(), "buyback").args_json(json!({"epoch": 2, "min_out": quote})).max_gas().transact().await?.into_result()?;
    let bb = view(&e.house, "get_buyback", json!({"epoch": 2})).await?;
    assert_eq!(bb["status"], json!("Done"));
    assert_eq!(bb["oneup"], json!(quote));
    assert_eq!(view(&e.ve, "get_rewards", json!({"epoch": 2, "market_id": "NEAR-USD"})).await?, json!([[e.oneup.id(), quote]]));

    // Alice is NEAR-USD's only voter: she gets it all (less rounding)
    let (alice, id) = &locks[0];
    let before: u128 = view(&e.oneup, "ft_balance_of", json!({"account_id": alice.id()})).await?.as_str().unwrap().parse()?;
    alice.call(e.ve.id(), "claim").args_json(json!({"token_id": id, "epochs": [2]})).max_gas().transact().await?.into_result()?;
    let after: u128 = view(&e.oneup, "ft_balance_of", json!({"account_id": alice.id()})).await?.as_str().unwrap().parse()?;
    let q: u128 = quote.parse()?;
    assert!(after - before <= q && q - (after - before) < 1_000, "{} of {}", after - before, q);
    Ok(())
}
