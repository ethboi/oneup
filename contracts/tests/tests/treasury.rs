//! Real receipt-chain coverage of deployed capital, refused recall, successful recall and withdrawal.
mod common;
use common::*;
use near_workspaces::types::NearToken;
use serde_json::json;

#[tokio::test]
async fn vault_recall_returns_real_tokens_before_a_winner_withdraws() -> anyhow::Result<()> {
    let e = setup(600).await?;
    e.keeper.call(e.house.id(), "deploy").args_json(json!({"amount":usd(80_000)})).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&e.vault, "deposit_of", json!({"account_id":e.house.id()})).await?["principal"], json!(usd(80_000)));
    let bob = trader(&e, "winner", 1000).await?;
    let (position, placed_at) = open(&e, &bob, "Long", 500, 50, 500).await?;
    push(&e, 600, placed_at + 2).await?;
    assert!(e.keeper.call(e.house.id(), "take_profit").args_json(json!({"position_id":position})).max_gas().transact().await?.json::<bool>()?);
    // Deliberately select a receiver without the vault interface: failure must retain deployed principal.
    e.owner.call(e.house.id(), "set_vault").args_json(json!({"vault":e.market.id()})).transact().await?.into_result()?;
    let refused = e.keeper.call(e.house.id(), "recall").args_json(json!({"amount":usd(80_000)})).max_gas().transact().await?;
    assert!(!refused.json::<bool>()?);
    assert_eq!(view(&e.house, "get_treasury", json!({})).await?["deployed"], json!(usd(80_000)));
    e.owner.call(e.house.id(), "set_vault").args_json(json!({"vault":e.vault.id()})).transact().await?.into_result()?;
    assert!(e.keeper.call(e.house.id(), "recall").args_json(json!({"amount":usd(80_000)})).max_gas().transact().await?.json::<bool>()?);
    assert_eq!(view(&e.house, "get_treasury", json!({})).await?["deployed"], json!("0"));
    assert_eq!(view(&e.vault, "deposit_of", json!({"account_id":e.house.id()})).await?["principal"], json!("0"));
    let due = view(&e.house, "get_balance", json!({"account_id":bob.id()})).await?;
    bob.call(e.house.id(), "withdraw").args_json(json!({"amount":due})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&e.usdc, "ft_balance_of", json!({"account_id":bob.id()})).await?, due);
    assert_eq!(view(&e.usdc, "ft_balance_of", json!({"account_id":e.house.id()})).await?, view(&e.house, "get_pool", json!({})).await?);
    Ok(())
}
