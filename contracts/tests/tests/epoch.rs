//! Sandbox test of a full epoch: lose → close the epoch → Extra Life NFT → pot → claim USDC.

mod common;
use common::*;
use serde_json::json;

#[tokio::test]
async fn lose_close_epoch_claim() -> anyhow::Result<()> {
    let e = setup(5).await?;

    // The seed provider holds the seed's Extra Life: 100K owed at 1.0×
    let seed = view(&e.life, "life_info", json!({"token_id": format!("0:{}", e.owner.id())})).await?;
    assert_eq!(seed["owed"], json!(usd(100_000)));

    // Bob loses 500 by liquidation
    let bob = trader(&e, "bob", 500).await?;
    let (pos, placed_at) = open(&e, &bob, "Long", 500, 50, 500).await?;
    push(&e, 490, placed_at + 2).await?;
    let ok: bool = e.keeper.call(e.house.id(), "liquidate").args_json(json!({"position_id": pos})).max_gas().transact().await?.json()?;
    assert!(ok);

    // Close the epoch, stepping until done
    e.worker.fast_forward(10).await?;
    let mut steps = vec![];
    loop {
        let r: String = e.keeper.call(e.house.id(), "close_epoch").args_json(json!({})).max_gas().transact().await?.into_result()?.json()?;
        steps.push(r.clone());
        if r == "closed" || steps.len() > 10 {
            break;
        }
    }
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

    // The pot: surplus 75_500 above the 25K reserve, half paid out, 60% of that to lives
    assert_eq!(summary["lives_pot"], json!(usd(22_650)));
    assert_eq!(view(&e.life, "held", json!({})).await?, json!(usd(22_650)));
    let claimable: u128 = life["claimable"].as_str().unwrap().parse()?;
    // pro rata to owed: 959.8 / 100_959.8 of the pot
    assert_eq!(claimable, 22_650 * USDC * 959_800_000 / 100_959_800_000);

    bob.call(e.life.id(), "claim").args_json(json!({"token_ids": [id]})).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&e.usdc, "ft_balance_of", json!({"account_id": bob.id()})).await?, json!(claimable.to_string()));
    Ok(())
}
