//! Funded, executable economic cases. These are bounded experiments, not a profitability forecast.
//! Every order, fill, distribution, claim and withdrawal runs through deployed WASM receipts.
mod common;
use common::*;
use near_workspaces::{types::NearToken, Account};
use serde_json::{json, Value};

fn amount(v: &Value) -> u128 { v.as_str().expect("USDC integer string").parse().unwrap() }
async fn ft(e: &Env, account: &str) -> anyhow::Result<u128> {
    Ok(amount(&view(&e.usdc, "ft_balance_of", json!({"account_id":account})).await?))
}
async fn balance(e: &Env, t: &Account) -> anyhow::Result<u128> {
    Ok(amount(&view(&e.house, "get_balance", json!({"account_id":t.id()})).await?))
}
async fn close_at(e: &Env, t: &Account, position: u64, cents: i64) -> anyhow::Result<()> {
    let opened = view(&e.house, "get_position", json!({"position_id":position})).await?["opened_at"].as_u64().unwrap();
    while e.worker.view_block().await?.timestamp() / 1_000_000_000 < opened + 62 {
        e.worker.fast_forward(50).await?;
    }
    let order: u64 = t.call(e.house.id(), "place_close").args_json(json!({"position_id":position})).transact().await?.into_result()?.json()?;
    let orders = view(&e.house, "get_orders", json!({"account_id":t.id()})).await?;
    let placed = orders.as_array().unwrap().iter().find(|o| o["id"] == order).unwrap()["placed_at"].as_u64().unwrap();
    push(e, cents, placed + 1).await?;
    assert!(e.keeper.call(e.house.id(), "fill").args_json(json!({"order_id":order})).max_gas().transact().await?.into_result()?.json::<bool>()?);
    assert!(view(&e.house, "get_position", json!({"position_id":position})).await?.is_null());
    Ok(())
}
async fn finish_round(e: &Env, epoch: u64) -> anyhow::Result<Value> {
    e.worker.fast_forward(10).await?;
    let steps = close_epoch(e).await?;
    assert_eq!(steps.last().map(String::as_str), Some("closed"));
    view(&e.house, "get_epoch_summary", json!({"epoch":epoch})).await
}
async fn withdraw_all(e: &Env, t: &Account) -> anyhow::Result<u128> {
    let cash = balance(e,t).await?;
    let wallet_before = ft(e,t.id().as_str()).await?;
    if cash > 0 {
        t.call(e.house.id(), "withdraw").args_json(json!({"amount":cash.to_string()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    }
    assert_eq!(balance(e,t).await?, 0);
    assert_eq!(ft(e,t.id().as_str()).await? - wallet_before, cash, "withdrawal must arrive in this trader wallet");
    Ok(cash)
}
async fn claim(e: &Env, t: &Account, token: &str) -> anyhow::Result<u128> {
    let before = ft(e,t.id().as_str()).await?;
    let available = amount(&view(&e.life,"life_info",json!({"token_id":token})).await?["claimable"]);
    if available > 0 {
        t.call(e.life.id(),"claim").args_json(json!({"token_ids":[token]})).max_gas().transact().await?.into_result()?;
    }
    assert_eq!(ft(e,t.id().as_str()).await? - before, available);
    assert_eq!(view(&e.life,"life_info",json!({"token_id":token})).await?["claimable"],json!("0"));
    Ok(available)
}

/// At a settled checkpoint, reconcile actual token custody and the house ledger independently.
/// Labels, not generated account names or credentials, are written into publishable evidence.
async fn cash_checkpoint(e: &Env, traders: &[(&str, &Account)]) -> anyhow::Result<Value> {
    assert!(view(&e.house,"list_positions",json!({})).await?.as_array().unwrap().is_empty());
    assert!(view(&e.house,"list_orders",json!({})).await?.as_array().unwrap().is_empty());
    let mut custody = serde_json::Map::new();
    let mut summed = 0u128;
    for (label, account) in [("house",e.house.id()),("life",e.life.id()),("ve",e.ve.id()),("swap",e.swap.id()),("market",e.market.id()),("vault",e.vault.id()),("usdc",e.usdc.id()),("oracle",e.oracle.id()),("oneup",e.oneup.id()),("seed_backer",e.owner.id()),("keeper",e.keeper.id())] {
        let cash = ft(e,account.as_str()).await?;
        custody.insert(label.into(),json!(cash.to_string())); summed += cash;
    }
    let mut house_free = 0u128;
    for (label,t) in traders {
        let cash = ft(e,t.id().as_str()).await?;
        custody.insert((*label).into(),json!(cash.to_string())); summed += cash;
        house_free += balance(e,t).await?;
    }
    let supply = amount(&view(&e.usdc,"ft_total_supply",json!({})).await?);
    assert_eq!(summed,supply,"all minted USDC must remain in the recorded accounts");
    let pool = amount(&view(&e.house,"get_pool",json!({})).await?);
    let buybacks = amount(&view(&e.house,"get_lives_state",json!({})).await?["buyback_usdc"]);
    let treasury = view(&e.house,"get_treasury",json!({})).await?;
    assert_eq!(treasury["deployed"],json!("0"),"these experiments do not use mock vault yield");
    let jackpot = amount(&treasury["jackpot"]);
    assert_eq!(ft(e,e.house.id().as_str()).await?,pool + house_free + buybacks + jackpot,"house cash must cover each ledger bucket exactly");
    assert_eq!(ft(e,e.life.id().as_str()).await?,amount(&view(&e.life,"held",json!({})).await?));
    Ok(json!({"usdc_total_supply":supply.to_string(),"wallet_usdc":custody,"house_pool":pool.to_string(),"house_free_balances":house_free.to_string(),"earmarked_buyback_usdc":buybacks.to_string(),"jackpot_usdc":jackpot.to_string(),"custody_matches_supply":true,"house_ledger_matches_custody":true}))
}
fn record(id: &str, result: Value) -> anyhow::Result<()> {
    let report = json!({"schema_version":1,"scenario":id,"passed":true,"units":{"usdc":"integer base units, 6 decimals","oneup":"integer base units, 18 decimals"},"environment":"fresh NEAR sandbox; mock USDC and controlled mock oracle; real OneUp WASM","result":result,"limits":["Fixed price paths are not market forecasts or demand validation.","NEAR gas and account/storage funding are excluded from USDC cash results.","Unsold NFTs and locked 1UP have no realized USDC value assigned.","No mock vault yield or simulated asset sale is counted as cash income."]});
    if let Ok(dir) = std::env::var("ONEUP_ECONOMICS_DIR") {
        std::fs::create_dir_all(&dir)?;
        std::fs::write(std::path::Path::new(&dir).join(format!("{id}.json")),serde_json::to_vec_pretty(&report)?)?;
    }
    Ok(())
}

#[tokio::test]
async fn admission_rejection_preserves_funded_cash() -> anyhow::Result<()> {
    let e = setup(5).await?;
    let t = trader(&e,"capacity-trader",6_000).await?;
    let initial = cash_checkpoint(&e,&[("trader",&t)]).await?;
    let quote = view(&e.house,"quote_open",json!({"market_id":"NEAR-USD","side":"Long","margin":usd(6_000),"leverage":1})).await?;
    assert_eq!(quote["allowed"],json!(false));
    assert_eq!(quote["reason"],json!("Market capacity reached"));
    let rejected = t.call(e.house.id(),"place_open").args_json(json!({"market_id":"NEAR-USD","side":"Long","margin":usd(6_000),"leverage":1})).transact().await?;
    assert!(format!("{:?}",rejected.into_result()).contains("Market capacity reached"));
    assert_eq!(balance(&e,&t).await?,6_000*USDC);
    let (position,_) = open(&e,&t,"Long",5_000,1,500).await?;
    let occupied = view(&e.house,"get_solvency",json!({})).await?;
    assert_eq!(occupied["liability"],json!(usd(45_000)));
    let before = balance(&e,&t).await?;
    let rejected = t.call(e.house.id(),"place_open").args_json(json!({"market_id":"NEAR-USD","side":"Short","margin":usd(1_000),"leverage":1})).transact().await?;
    assert!(format!("{:?}",rejected.into_result()).contains("Market capacity reached"));
    assert_eq!(balance(&e,&t).await?,before);
    assert_eq!(view(&e.house,"get_solvency",json!({})).await?["liability"],occupied["liability"]);
    close_at(&e,&t,position,500).await?;
    assert_eq!(withdraw_all(&e,&t).await?,6_000*USDC);
    let final_cash = cash_checkpoint(&e,&[("trader",&t)]).await?;
    record("admission", json!({
        "accepted_orders":1,
        "rejected_orders":2,
        "initial":initial,
        "occupied_solvency":occupied,
        "final":final_cash,
        "trader_realized_usdc_change":"0",
        "assertions":["Quote and actual receipt reject excess capacity.",
        "Rejected orders debit no margin and add no liability.",
        "One accepted position closes flat and all 6000 USDC withdraws.",
        "Token custody and house ledger reconcile."]
    }))
}

#[tokio::test]
async fn inactive_rounds_expire_future_rights_but_preserve_claims() -> anyhow::Result<()> {
    // Shortened expiry isolates the boundary without pretending a real product round lasts seconds.
    let e = setup_with(5,0).await?;
    let backer_account = e.owner.create_subaccount("new-backer").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    backer_account.call(e.usdc.id(),"faucet").args_json(json!({"amount":usd(10_000)})).transact().await?.into_result()?;
    transfer_call(&backer_account,&e.usdc,e.house.id().as_str(),usd(10_000),r#"{"back":{}}"#).await?;
    let backed_life = view(&e.life,"life_info",json!({"token_id":"b2"})).await?;
    assert_eq!(backed_life["owed"],json!(usd(19_160)));
    assert_eq!(balance(&e,&backer_account).await?,0,"backing is not a withdrawable trading balance");
    let loser = trader(&e,"inactive-loser",500).await?;
    let initial = cash_checkpoint(&e,&[("trader",&loser),("new_backer",&backer_account)]).await?;
    let (position,placed) = open(&e,&loser,"Long",500,50,500).await?;
    push(&e,490,placed+2).await?;
    assert!(e.keeper.call(e.house.id(),"liquidate").args_json(json!({"position_id":position})).max_gas().transact().await?.into_result()?.json::<bool>()?);
    let first = finish_round(&e,1).await?;
    let id = format!("1:{}",loser.id());
    let active = view(&e.life,"life_info",json!({"token_id":id})).await?;
    assert_eq!(active["claimable"],json!(usd(100)));
    let second = finish_round(&e,2).await?;
    let third = finish_round(&e,3).await?;
    for summary in [&second,&third] {
        assert_eq!(summary["losses"],json!("0")); assert_eq!(summary["payouts"],json!("0")); assert_eq!(summary["house_net"],json!("0"));
        assert!(amount(&summary["lives_pot"]) > 0,"previously retained surplus can still pay despite no new activity");
    }
    let expired = view(&e.life,"life_info",json!({"token_id":id})).await?;
    assert_eq!(expired["expired"],json!(true));
    assert_eq!(expired["paid"],active["paid"]);
    assert_eq!(expired["claimable"],active["claimable"]);
    let recovered = claim(&e,&loser,&id).await?;
    assert_eq!(recovered,100*USDC);
    let backer = view(&e.life,"life_info",json!({"token_id":"b1"})).await?;
    let backer_cash = claim(&e,&e.owner,"b1").await?;
    assert!(backer_cash > 0 && backer_cash < 100_000*USDC);
    let new_backer_life = view(&e.life,"life_info",json!({"token_id":"b2"})).await?;
    let new_backer_cash = claim(&e,&backer_account,"b2").await?;
    assert!(new_backer_cash > 0 && new_backer_cash < 10_000*USDC);
    let final_cash = cash_checkpoint(&e,&[("trader",&loser),("new_backer",&backer_account)]).await?;
    record("inactive-expiry", json!({
        "accepted_orders":1,
        "rejected_orders":0,
        "life_expiry_epochs":0,
        "initial":initial,
        "rounds":[first,second,third],
        "loss_usdc":usd(500),
        "recovery_claimed_usdc":recovered.to_string(),
        "trader_realized_usdc_change":(recovered as i128-500*USDC as i128).to_string(),
        "life_maximum_total_payout_usdc":expired["owed"],
        "life_allocated_before_expiry_usdc":active["paid"],
        "life_allocated_after_expiry_usdc":expired["paid"],
        "seed_backer":{"principal_contributed_usdc":usd(100_000),
        "maximum_total_payout_usdc":backer["owed"],
        "allocated_usdc":backer["paid"],
        "claimed_usdc":backer_cash.to_string(),
        "net_realized_usdc":(backer_cash as i128-100_000*USDC as i128).to_string(),
        "principal_is_withdrawable":false},
        "new_backer":{"principal_contributed_usdc":usd(10_000),
        "maximum_total_payout_usdc":new_backer_life["owed"],
        "allocated_usdc":new_backer_life["paid"],
        "claimed_usdc":new_backer_cash.to_string(),
        "net_realized_usdc":(new_backer_cash as i128-10_000*USDC as i128).to_string(),
        "principal_is_withdrawable":false},
        "final":final_cash,
        "assertions":["An expired Life earns no additional allocations.",
        "Expiry preserves the previously allocated 100 USDC, which is actually claimed.",
        "Inactive rounds can distribute retained surplus, not new house profit.",
        "Backer cap and principal are separate from cash actually claimed.",
        "Token custody and house ledger reconcile."]
    }))
}

#[tokio::test]
async fn adverse_house_result_pays_winner_without_distributing_reserve() -> anyhow::Result<()> {
    let e = setup(5).await?;
    let winner = trader(&e,"winning-trader",1_000).await?;
    let initial = cash_checkpoint(&e,&[("trader",&winner)]).await?;
    let (position,_) = open(&e,&winner,"Long",500,10,500).await?;
    close_at(&e,&winner,position,600).await?;
    let summary = finish_round(&e,1).await?;
    assert_eq!(summary["cuts"],json!("122500000"));
    assert_eq!(summary["payouts"],json!("877500000"));
    assert_eq!(summary["house_net"],json!("0"),"this unsigned distribution field is not signed economic profit");
    assert_eq!(summary["lives_pot"],json!("0")); assert_eq!(summary["buyback_pot"],json!("0")); assert_eq!(summary["lives_minted"],json!(0));
    assert!(amount(&summary["pool"]) < amount(&summary["reserve"]));
    assert_eq!(view(&e.life,"life_info",json!({"token_id":"b1"})).await?["claimable"],json!("0"));
    let returned = withdraw_all(&e,&winner).await?;
    assert_eq!(returned,1_877_500_000);
    let final_cash = cash_checkpoint(&e,&[("trader",&winner)]).await?;
    record("adverse-house", json!({
        "accepted_orders":1,
        "rejected_orders":0,
        "initial":initial,
        "round":summary,
        "gross_trader_profit_usdc":usd(1_000),
        "profit_fee_usdc":"122500000",
        "trader_realized_usdc_change":"877500000",
        "signed_house_trading_result_usdc":"-877500000",
        "unsigned_house_distribution_base_usdc":"0",
        "seed_backer_principal_usdc":usd(100_000),
        "seed_backer_claimed_usdc":"0",
        "final":final_cash,
        "assertions":["Actual winner withdrawal includes net profit after the fee.",
        "The house can fall below the seed reserve floor when paying admitted winning trades.",
        "No Life or buyback payout distributes a negative surplus.",
        "Unsigned house_net is not reported as break-even economic profit.",
        "Token custody and house ledger reconcile."]
    }))
}

#[tokio::test]
async fn paired_wallets_do_not_turn_unsold_rewards_into_realized_cash() -> anyhow::Result<()> {
    let e = setup(5).await?;
    let long = trader(&e,"pair-long",1_000).await?;
    let short = trader(&e,"pair-short",1_000).await?;
    let initial = cash_checkpoint(&e,&[("long_wallet",&long),("short_wallet",&short)]).await?;
    let (long_pos,_) = open(&e,&long,"Long",500,10,500).await?;
    let (short_pos,_) = open(&e,&short,"Short",500,10,500).await?;
    close_at(&e,&long,long_pos,510).await?;
    close_at(&e,&short,short_pos,510).await?;
    let combined_after_trading = balance(&e,&long).await? + balance(&e,&short).await?;
    assert_eq!(combined_after_trading,1_987_750_000);
    let summary = finish_round(&e,1).await?;
    assert_eq!(summary["cuts"],json!("12250000")); assert_eq!(summary["losses"],json!(usd(100))); assert_eq!(summary["payouts"],json!("87750000"));
    let id = format!("1:{}",short.id());
    let life = view(&e.life,"life_info",json!({"token_id":id})).await?;
    assert_eq!(life["face"],json!("12250000"),"the Life face is the house's net result, not the full losing trade");
    let recovery = claim(&e,&short,&id).await?;
    assert_eq!(recovery,2_450_000);
    withdraw_all(&e,&long).await?; withdraw_all(&e,&short).await?;
    let final_combined = ft(&e,long.id().as_str()).await? + ft(&e,short.id().as_str()).await?;
    assert_eq!(final_combined,1_990_200_000);
    assert!(final_combined < 2_000*USDC);
    let locks = view(&e.ve,"locks_for_owner",json!({"account_id":short.id()})).await?;
    assert_eq!(locks.as_array().unwrap().len(),1);
    assert_eq!(locks[0]["amount"],json!((245u128*10u128.pow(18)).to_string()));
    let final_cash = cash_checkpoint(&e,&[("long_wallet",&long),("short_wallet",&short)]).await?;
    record("paired-wallets", json!({
        "accepted_orders":2,
        "rejected_orders":0,
        "initial":initial,
        "round":summary,
        "combined_initial_usdc":usd(2_000),
        "combined_after_trading_usdc":combined_after_trading.to_string(),
        "profit_fee_usdc":"12250000",
        "recovery_claimed_usdc":recovery.to_string(),
        "combined_final_wallet_usdc":final_combined.to_string(),
        "combined_realized_usdc_change":"-9800000",
        "life_maximum_total_payout_usdc":life["owed"],
        "locked_oneup":locks[0]["amount"],
        "nft_sale_proceeds_usdc":"0",
        "oneup_sale_proceeds_usdc":"0",
        "final":final_cash,
        "assertions":["Both opposite orders satisfy actual contract admission rules.",
        "Winning and losing trades close at the same entry and exit prices.",
        "Cash withdrawals plus the actual recovery claim leave the pair 9.80 USDC below initial funds.",
        "The 245 locked 1UP and unsold Life are disclosed separately from cash.",
        "This fixed case does not prove that every farming strategy is unprofitable.",
        "Token custody and house ledger reconcile."]
    }))
}
