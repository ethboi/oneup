//! Real failed cross-contract receipts and callback-interruption recovery on an isolated sandbox.
mod common;
use common::*;
use serde_json::json;
use near_workspaces::types::NearToken;

#[tokio::test]
async fn failed_receipts_retry_without_losing_owners_terms_or_original_pot() -> anyhow::Result<()> {
    let e = setup(5).await?;
    let bob = trader(&e, "recovery-bob", 500).await?;
    let buyer = trader(&e, "recovery-buyer", 1).await?;
    let (pos, placed) = open(&e, &bob, "Long", 500, 50, 500).await?;
    push(&e, 490, placed + 2).await?;
    assert!(e.keeper.call(e.house.id(), "liquidate").args_json(json!({"position_id":pos})).max_gas().transact().await?.json::<bool>()?);

    // Temporarily remove receiver methods at the SAME accounts, preserving their state. The FT
    // transfer really fails/refunds; no test-only switches are compiled into production contracts.
    e.life.as_account().deploy(&wasm("mock_oracle")).await?.into_result()?;
    e.ve.as_account().deploy(&wasm("mock_oracle")).await?.into_result()?;
    e.worker.fast_forward(10).await?;
    assert_eq!(e.keeper.call(e.house.id(), "close_epoch").args_json(json!({})).max_gas().transact().await?.into_result()?.json::<String>()?, "begun");
    assert_eq!(e.keeper.call(e.house.id(), "close_epoch").args_json(json!({})).max_gas().transact().await?.into_result()?.json::<String>()?, "minting");
    let queued = view(&e.house, "get_recovery_batches", json!({})).await?;
    let batch = queued[0].clone();
    let id = batch["batch_id"].as_u64().unwrap();
    assert_eq!(batch["lives"][0]["owner"], json!(bob.id()));
    assert_eq!(batch["lives"][0]["face"], json!(usd(500)));
    assert_eq!(batch["lock_created_epoch"], json!(2));
    let owed = view(&e.house, "get_lives_state", json!({})).await?["lives_owed"].clone();
    let carry = view(&e.house, "get_emission_carry", json!({})).await?;
    for _ in 0..2 {
        assert!(e.keeper.call(e.house.id(), "retry_recovery").args_json(json!({"batch_id":id})).max_gas().transact().await?.into_result()?.json::<bool>()?);
        assert_eq!(view(&e.house, "get_lives_state", json!({})).await?["lives_owed"], owed);
        assert_eq!(view(&e.house, "get_emission_carry", json!({})).await?, carry);
        assert_eq!(view(&e.house, "get_closing", json!({})).await?["lives_minted"], json!(0));
        assert!(view(&e.house, "get_epoch_summary", json!({"epoch":1})).await?.is_null());
    }

    e.life.as_account().deploy(&wasm("oneup_extra_life")).await?.into_result()?;
    e.ve.as_account().deploy(&wasm("oneup_ve")).await?.into_result()?;

    // Reproduce a successful destination receipt with a missing confirmation. Sandbox accounts have
    // test keys: sign as the house to deliver exactly the persisted payload, without its callback.
    e.house.as_account().call(e.life.id(), "mint_batch").args_json(json!({"epoch":1,"items":batch["lives"]})).max_gas().transact().await?.into_result()?;
    let token_id = format!("1:{}", bob.id());
    bob.call(e.life.id(), "nft_transfer").args_json(json!({"receiver_id":buyer.id(),"token_id":token_id})).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    let oneup_before: u128 = view(&e.oneup, "ft_balance_of", json!({"account_id":e.house.id()})).await?.as_str().unwrap().parse()?;
    let lock_amount = batch["locks"][0][1].as_str().unwrap().to_string();
    let msg = json!({"recovery_locks":{"batch_id":id,"created":2,"items":batch["locks"]}}).to_string();
    transfer_call(e.house.as_account(), &e.oneup, e.ve.id().as_str(), lock_amount.clone(), &msg).await?;
    let lock = view(&e.ve, "locks_for_owner", json!({"account_id":bob.id()})).await?[0].clone();
    bob.call(e.ve.id(), "nft_transfer").args_json(json!({"receiver_id":buyer.id(),"token_id":lock["token_id"]})).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    // Closing is still interrupted with both obligations pending despite successful receiver state.
    assert_eq!(view(&e.house, "get_closing", json!({})).await?["pending_mints"], json!(2));

    let steps = close_epoch(&e).await?;
    assert_eq!(steps.last().map(String::as_str), Some("closed"), "{steps:?}");
    assert!(view(&e.house, "get_recovery_batches", json!({})).await?.as_array().unwrap().is_empty());
    assert!(!e.keeper.call(e.house.id(), "retry_recovery").args_json(json!({"batch_id":id})).max_gas().transact().await?.into_result()?.json::<bool>()?);
    assert_eq!(view(&e.house, "get_epoch_summary", json!({"epoch":1})).await?["lives_minted"], json!(1));
    let life = view(&e.life, "life_info", json!({"token_id":token_id})).await?;
    assert_eq!(life["owner_id"], json!(buyer.id()));
    assert_eq!(life["epoch"], json!(1));
    assert_eq!(life["cap_ppm"], batch["lives"][0]["cap_ppm"]);
    assert_eq!(life["claimable"], json!(usd(100)), "the recovered NFT still shares its originating pot");
    assert_eq!(view(&e.life, "nft_total_supply", json!({})).await?, json!("2")); // seed + one loss
    let locks = view(&e.ve, "locks_for_owner", json!({"account_id":buyer.id()})).await?;
    assert_eq!(locks.as_array().unwrap().len(), 1);
    assert_eq!(locks[0]["created"], json!(2));
    assert_eq!(locks[0]["end"], json!(107));
    let oneup_after: u128 = view(&e.oneup, "ft_balance_of", json!({"account_id":e.house.id()})).await?.as_str().unwrap().parse()?;
    assert_eq!(oneup_before - oneup_after, lock_amount.parse::<u128>()?, "duplicate retry transfer was refunded");
    assert_eq!(view(&e.house, "get_emissions", json!({"epoch":1})).await?["locked"], json!(lock_amount));
    buyer.call(e.life.id(), "claim").args_json(json!({"token_ids":[token_id]})).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&e.usdc, "ft_balance_of", json!({"account_id":buyer.id()})).await?, json!(usd(100)));
    Ok(())
}
