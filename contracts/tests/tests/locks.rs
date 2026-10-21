//! Sandbox: a loss becomes a $1UP lock (D-16); the epoch's buyback is swapped and paid to lockers by
//! weight (D-15); leaving a lock early pays the lockers who stay.

mod common;
use common::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::json;

const ONEUP: u128 = 1_000_000_000_000_000_000;

fn oneup(x: u128) -> String {
    (x * ONEUP).to_string()
}

async fn balance(e: &Env, a: &Account) -> anyhow::Result<u128> {
    Ok(view(&e.oneup, "ft_balance_of", json!({"account_id": a.id()})).await?.as_str().unwrap().parse()?)
}

#[tokio::test]
async fn loss_becomes_a_lock_and_lockers_earn_the_buyback() -> anyhow::Result<()> {
    let e = setup(5).await?;

    // Swap liquidity: 100K USDC / 10M $1UP (the owner holds the Rhea seed allocation)
    e.owner.call(e.usdc.id(), "mint").args_json(json!({"receiver_id": e.owner.id(), "amount": usd(100_000)})).transact().await?.into_result()?;
    transfer_call(&e.owner, &e.usdc, e.swap.id().as_str(), usd(100_000), r#"{"add_liquidity":{}}"#).await?;
    transfer_call(&e.owner, &e.oneup, e.swap.id().as_str(), oneup(10_000_000), r#"{"add_liquidity":{}}"#).await?;

    // Alice locks 1_000 $1UP by hand for the full 104 epochs: it counts from epoch 2
    let alice = e.owner.create_subaccount("alice").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    register(&e.owner, &e.oneup, alice.id().as_str()).await?;
    transfer(&e.owner, &e.oneup, alice.id().as_str(), oneup(1_000)).await?;
    transfer_call(&alice, &e.oneup, e.ve.id().as_str(), oneup(1_000), r#"{"lock":{"epochs":104}}"#).await?;
    let alice_lock = view(&e.ve, "locks_for_owner", json!({"account_id": alice.id()})).await?[0]["token_id"].as_str().unwrap().to_string();

    // Epoch 1 passes quietly; nothing is released without house profit
    e.worker.fast_forward(10).await?;
    close_epoch(&e).await?;
    assert_eq!(view(&e.house, "get_emissions", json!({"epoch": 1})).await?["released"], json!("0"));

    // Epoch 2: Carol is liquidated for 500
    let carol = trader(&e, "carol", 500).await?;
    register(&e.owner, &e.oneup, carol.id().as_str()).await?;
    let (pos, placed_at) = open(&e, &carol, "Long", 500, 50, 500).await?;
    push(&e, 490, placed_at + 2).await?;
    let ok: bool = e.keeper.call(e.house.id(), "liquidate").args_json(json!({"position_id": pos})).max_gas().transact().await?.json()?;
    assert!(ok);
    e.worker.fast_forward(10).await?;
    let steps = close_epoch(&e).await?;
    assert_eq!(steps.last().map(String::as_str), Some("closed"), "{steps:?}");

    // 500 of house profit × 20 → 10_000 $1UP, all Carol's, as a 104-epoch lock
    let em = view(&e.house, "get_emissions", json!({"epoch": 2})).await?;
    assert_eq!(em["released"], json!(oneup(10_000)));
    assert_eq!(em["locked"], json!(oneup(10_000)));
    let carol_locks = view(&e.ve, "locks_for_owner", json!({"account_id": carol.id()})).await?;
    let carol_lock = &carol_locks[0];
    assert_eq!(carol_lock["amount"], json!(oneup(10_000)));
    assert_eq!(carol_lock["from_loss"], json!(true));
    let end = carol_lock["end"].as_u64().unwrap();
    assert_eq!(end - carol_lock["created"].as_u64().unwrap(), 105);
    // and her Extra Life
    let life = view(&e.life, "life_info", json!({"token_id": format!("2:{}", carol.id())})).await?;
    assert_eq!(life["face"], json!(usd(500)));

    // The epoch-2 buyback: swap → ve, for epoch 2's lockers. Only Alice was locked through epoch 2.
    let bb = view(&e.house, "get_buyback", json!({"epoch": 2})).await?;
    let usdc: u128 = bb["usdc"].as_str().unwrap().parse()?;
    let quote: String = view(&e.swap, "get_quote", json!({"usdc_in": usdc.to_string()})).await?.as_str().unwrap().into();
    e.owner.call(e.house.id(), "buyback").args_json(json!({"epoch": 2, "min_out": quote})).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&e.house, "get_buyback", json!({"epoch": 2})).await?["status"], json!("Done"));
    assert_eq!(view(&e.ve, "get_rewards", json!({"epoch": 2})).await?, json!(quote));

    let before = balance(&e, &alice).await?;
    alice.call(e.ve.id(), "claim").args_json(json!({"token_id": alice_lock, "epochs": [2]})).max_gas().transact().await?.into_result()?;
    let got = balance(&e, &alice).await? - before;
    let q: u128 = quote.parse()?;
    assert!(got <= q && q - got < 1_000, "{got} of {q}");

    // Carol leaves her lock early: 103 of 104 epochs left after this one → she pays ~49.5%, kept for
    // the lockers who stay (epoch 4's)
    let token = carol_lock["token_id"].as_str().unwrap();
    let penalty: String = carol.call(e.ve.id(), "exit_early").args_json(json!({"token_id": token})).max_gas().transact().await?.into_result()?.json()?;
    let penalty: u128 = penalty.parse()?;
    let left = end - 3 - 1;
    assert_eq!(penalty, (10_000 * ONEUP * 500_000 * left as u128).div_ceil(1_000_000 * 104));
    assert_eq!(balance(&e, &carol).await?, 10_000 * ONEUP - penalty);
    assert_eq!(view(&e.ve, "get_rewards", json!({"epoch": 4})).await?, json!(penalty.to_string()));
    Ok(())
}
