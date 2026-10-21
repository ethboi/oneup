//! Sandbox test of a full epoch: lose → close the epoch → Extra Life NFT → pot → claim USDC.

mod common;
use common::*;
use serde_json::json;

#[tokio::test]
async fn lose_close_epoch_claim() -> anyhow::Result<()> {
    let e = setup(5).await?;

    // The seed provider holds the seed's Backer Life: 100K owed at 1.0×, never expiring (D-22)
    let seed = view(&e.life, "life_info", json!({"token_id": "b1"})).await?;
    assert_eq!(seed["owed"], json!(usd(100_000)));
    assert_eq!(seed["owner_id"], json!(e.owner.id()));
    assert_eq!(seed["backer"], json!(true));

    // Bob loses 500 by liquidation
    let bob = trader(&e, "bob", 500).await?;
    let (pos, placed_at) = open(&e, &bob, "Long", 500, 50, 500).await?;
    push(&e, 490, placed_at + 2).await?;
    let ok: bool = e.keeper.call(e.house.id(), "liquidate").args_json(json!({"position_id": pos})).max_gas().transact().await?.json()?;
    assert!(ok);

    // Close the epoch, stepping until done
    e.worker.fast_forward(10).await?;
    let steps = close_epoch(&e).await?;
    assert_eq!(steps.first().map(String::as_str), Some("begun"));
    assert_eq!(steps.last().map(String::as_str), Some("closed"), "{steps:?}");

    // Bob's Extra Life: face 500 (the whole house profit), cap 2.0 − 0.8 × 100_500 / 1M = 1.9196×
    let summary = view(&e.house, "get_epoch_summary", json!({"epoch": 1})).await?;
    assert_eq!(summary["house_net"], json!(usd(500)));
    assert_eq!(summary["lives_minted"], json!(1));
    let id = format!("1:{}", bob.id());
    let life = view(&e.life, "life_info", json!({"token_id": id})).await?;
    assert_eq!(life["face"], json!(usd(500)));
    assert_eq!(life["owed"], json!("959800000"));

    // The pot: the reserve never drops below the 100K seed, so only the 500 profit is surplus;
    // half is paid out, 60% of that (150) to lives
    assert_eq!(summary["surplus"], json!(usd(500)));
    assert_eq!(summary["lives_pot"], json!(usd(150)));
    assert_eq!(view(&e.life, "held", json!({})).await?, json!(usd(150)));
    let claimable: u128 = life["claimable"].as_str().unwrap().parse()?;
    // pro rata to owed: 959.8 / 100_959.8 of the pot
    assert_eq!(claimable, 150 * USDC * 959_800_000 / 100_959_800_000);

    bob.call(e.life.id(), "claim").args_json(json!({"token_ids": [id]})).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&e.usdc, "ft_balance_of", json!({"account_id": bob.id()})).await?, json!(claimable.to_string()));
    Ok(())
}

/// D-13: with a zero-epoch window a life only shares the pot of the epoch it was minted in.
#[tokio::test]
async fn lives_expire_after_their_window() -> anyhow::Result<()> {
    let e = setup_with(5, 0).await?;
    let bob = trader(&e, "bob", 500).await?;
    let (pos, placed_at) = open(&e, &bob, "Long", 500, 50, 500).await?;
    push(&e, 490, placed_at + 2).await?;
    let ok: bool = e.keeper.call(e.house.id(), "liquidate").args_json(json!({"position_id": pos})).max_gas().transact().await?.json()?;
    assert!(ok);
    e.worker.fast_forward(10).await?;
    close_epoch(&e).await?; // epoch 1: Bob's life is minted and paid from epoch 1's pot
    let id = format!("1:{}", bob.id());
    let paid_1 = view(&e.life, "life_info", json!({"token_id": id})).await?["paid"].clone();
    assert_ne!(paid_1, json!("0"));

    e.worker.fast_forward(10).await?;
    let steps = close_epoch(&e).await?; // epoch 2: epoch-1 lives expire before the pot
    assert!(steps.iter().any(|s| s == "expiring"), "{steps:?}");
    let life = view(&e.life, "life_info", json!({"token_id": id})).await?;
    assert_eq!(life["expired"], json!(true));
    assert_eq!(life["paid"], paid_1, "an expired life earns nothing more");
    // the house mirrors the life contract's total
    let owed = view(&e.life, "total_owed_remaining", json!({})).await?;
    assert_eq!(view(&e.house, "get_lives_state", json!({})).await?["lives_owed"], owed);
    Ok(())
}
