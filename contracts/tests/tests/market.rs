//! Sandbox: the marketplace (D-17). A loser lists their Extra Life and their $1UP lock; a buyer pays
//! USDC and gets each NFT, with change back; a stale listing refunds the buyer.

mod common;
use common::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::json;

async fn usdc(e: &Env, a: &Account) -> anyhow::Result<u128> {
    Ok(view(&e.usdc, "ft_balance_of", json!({"account_id": a.id()})).await?.as_str().unwrap().parse()?)
}

async fn list(e: &Env, seller: &Account, nft: &near_workspaces::Contract, token_id: &str, price: u128) -> anyhow::Result<()> {
    seller
        .call(nft.id(), "nft_approve")
        .args_json(json!({"token_id": token_id, "account_id": e.market.id(), "msg": format!(r#"{{"price":"{}"}}"#, price * USDC)}))
        .deposit(NearToken::from_millinear(10))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

/// Buys at the listing `price` the buyer saw, sending `pay` (any extra comes back as change).
async fn buy(e: &Env, buyer: &Account, nft: &near_workspaces::Contract, token_id: &str, price: u128, pay: u128) -> anyhow::Result<()> {
    let msg = json!({"buy": {"nft_contract": nft.id(), "token_id": token_id, "price": usd(price).to_string()}}).to_string();
    transfer_call(buyer, &e.usdc, e.market.id().as_str(), usd(pay), &msg).await
}

async fn owner_of(nft: &near_workspaces::Contract, token_id: &str) -> anyhow::Result<String> {
    Ok(view(nft, "nft_token", json!({"token_id": token_id})).await?["owner_id"].as_str().unwrap().to_string())
}

#[tokio::test]
async fn sell_an_extra_life_and_a_lock() -> anyhow::Result<()> {
    let e = setup(5).await?;

    // Bob loses 500 and the epoch closes: an Extra Life and a $1UP lock
    let bob = trader(&e, "bob", 500).await?;
    let (pos, placed_at) = open(&e, &bob, "Long", 500, 50, 500).await?;
    push(&e, 490, placed_at + 2).await?;
    let ok: bool = e.keeper.call(e.house.id(), "liquidate").args_json(json!({"position_id": pos})).max_gas().transact().await?.json()?;
    assert!(ok);
    e.worker.fast_forward(10).await?;
    close_epoch(&e).await?;
    let life_id = format!("1:{}", bob.id());
    let lock_id = view(&e.ve, "locks_for_owner", json!({"account_id": bob.id()})).await?[0]["token_id"].as_str().unwrap().to_string();

    // Dave has USDC in his wallet
    let dave = e.owner.create_subaccount("dave").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    dave.call(e.usdc.id(), "faucet").args_json(json!({"amount": usd(1_000)})).transact().await?.into_result()?;

    // Bob lists the life for 300 and Dave pays 320: the life moves, Bob gets 300, Dave 20 change
    list(&e, &bob, &e.life, &life_id, 300).await?;
    let l = view(&e.market, "get_listing", json!({"nft_contract": e.life.id(), "token_id": life_id})).await?;
    assert_eq!(l["price"], json!(usd(300)));
    let bob_before = usdc(&e, &bob).await?;
    buy(&e, &dave, &e.life, &life_id, 300, 320).await?;
    assert_eq!(owner_of(&e.life, &life_id).await?, dave.id().to_string());
    assert_eq!(usdc(&e, &bob).await? - bob_before, 300 * USDC);
    assert_eq!(usdc(&e, &dave).await?, 700 * USDC);
    assert_eq!(view(&e.market, "get_listings", json!({})).await?, json!([]));
    // the life's USDC claims go to its new owner
    assert_eq!(view(&e.life, "life_info", json!({"token_id": life_id})).await?["owner_id"], json!(dave.id()));

    // Bob lists the lock for 200, then gives it away before anyone buys: the listing is stale
    list(&e, &bob, &e.ve, &lock_id, 200).await?;
    let carol = e.owner.create_subaccount("carol").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    bob.call(e.ve.id(), "nft_transfer")
        .args_json(json!({"receiver_id": carol.id(), "token_id": lock_id}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    // Dave tries to buy it: the NFT can't move, so his 200 comes back and the listing is gone
    buy(&e, &dave, &e.ve, &lock_id, 200, 200).await?;
    assert_eq!(owner_of(&e.ve, &lock_id).await?, carol.id().to_string());
    assert_eq!(usdc(&e, &dave).await?, 700 * USDC);
    assert!(view(&e.market, "get_listing", json!({"nft_contract": e.ve.id(), "token_id": lock_id})).await?.is_null());

    // Carol lists it herself and Dave buys it: the lock is his
    list(&e, &carol, &e.ve, &lock_id, 150).await?;
    buy(&e, &dave, &e.ve, &lock_id, 150, 150).await?;
    assert_eq!(owner_of(&e.ve, &lock_id).await?, dave.id().to_string());
    assert_eq!(usdc(&e, &dave).await?, 550 * USDC);
    assert_eq!(view(&e.ve, "locks_for_owner", json!({"account_id": dave.id()})).await?[0]["token_id"], json!(lock_id));
    Ok(())
}

/// Security review fixes: a listing can't be emptied, re-priced or closed under a buyer.
#[tokio::test]
async fn a_listing_cannot_change_under_the_buyer() -> anyhow::Result<()> {
    let e = setup(5).await?;
    let bob = trader(&e, "bob", 500).await?;
    let dave = e.owner.create_subaccount("dave").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    dave.call(e.usdc.id(), "faucet").args_json(json!({"amount": usd(1_000)})).transact().await?.into_result()?;
    let up = |x: u128| (x * 10u128.pow(18)).to_string();
    register(&e.owner, &e.oneup, bob.id().as_str()).await?;
    transfer(&e.owner, &e.oneup, bob.id().as_str(), up(1_001)).await?;
    let lock = |amount: u128| {
        let (bob, e, up) = (&bob, &e, &up);
        async move {
            transfer_call(bob, &e.oneup, e.ve.id().as_str(), up(amount), r#"{"lock":{"epochs":52}}"#).await?;
            let locks = view(&e.ve, "locks_for_owner", json!({"account_id": bob.id()})).await?;
            anyhow::Ok(locks.as_array().unwrap().last().unwrap()["token_id"].as_str().unwrap().to_string())
        }
    };

    // Bob locks $1UP and lists the lock, then exits early: the lock is empty, so the sale must fail
    let lock_id = lock(1_000).await?;
    list(&e, &bob, &e.ve, &lock_id, 100).await?;
    bob.call(e.ve.id(), "exit_early").args_json(json!({"token_id": lock_id})).max_gas().transact().await?.into_result()?;
    buy(&e, &dave, &e.ve, &lock_id, 100, 100).await?;
    assert_eq!(owner_of(&e.ve, &lock_id).await?, bob.id().to_string());
    assert_eq!(usdc(&e, &dave).await?, 1_000 * USDC, "refunded in full");

    // A re-price after the buyer looked: the buy carries the price it saw, so it's refused
    let lock2 = lock(1).await?;
    list(&e, &bob, &e.ve, &lock2, 50).await?;
    list(&e, &bob, &e.ve, &lock2, 90).await?; // re-approve at a higher price
    buy(&e, &dave, &e.ve, &lock2, 50, 90).await?;
    assert_eq!(owner_of(&e.ve, &lock2).await?, bob.id().to_string());
    assert_eq!(usdc(&e, &dave).await?, 1_000 * USDC);
    Ok(())
}


#[tokio::test]
async fn buyer_gas_cannot_separate_nft_delivery_from_payment() -> anyhow::Result<()> {
    let e = setup_with_fee(5, 13, 20_000).await?;
    let seller = e.owner.create_subaccount("seller").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let buyer = e.owner.create_subaccount("buyer").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    register(&e.owner, &e.oneup, seller.id().as_str()).await?;
    seller.call(e.usdc.id(), "faucet").args_json(json!({"amount": usd(1)})).transact().await?.into_result()?;
    buyer.call(e.usdc.id(), "faucet").args_json(json!({"amount": usd(1000)})).transact().await?.into_result()?;
    transfer(&e.owner, &e.oneup, seller.id().as_str(), (1000u128 * 10u128.pow(18)).to_string()).await?;
    for gas in [80, 100, 140, 155, 160, 180, 300] {
        transfer_call(&seller, &e.oneup, e.ve.id().as_str(), (10u128.pow(18)).to_string(), r#"{"lock":{"epochs":52}}"#).await?;
        let locks = view(&e.ve, "locks_for_owner", json!({"account_id": seller.id()})).await?;
        let id = locks.as_array().unwrap().last().unwrap()["token_id"].as_str().unwrap().to_string();
        list(&e, &seller, &e.ve, &id, 100).await?;
        let before_buyer = usdc(&e, &buyer).await?;
        let before_seller = usdc(&e, &seller).await?;
        let before_pool: u128 = view(&e.house, "get_pool", json!({})).await?.as_str().unwrap().parse()?;
        let msg = json!({"buy":{"nft_contract":e.ve.id(),"token_id":id,"price":usd(100)}}).to_string();
        let _ = buyer.call(e.usdc.id(), "ft_transfer_call").args_json(json!({"receiver_id":e.market.id(),"amount":usd(120),"msg":msg})).deposit(NearToken::from_yoctonear(1)).gas(near_workspaces::types::Gas::from_tgas(gas)).transact().await?;
        let owner = owner_of(&e.ve, &id).await?;
        if owner == buyer.id().as_str() {
            assert_eq!(before_buyer - usdc(&e, &buyer).await?, 100 * USDC, "gas {gas}: buyer pays");
            assert_eq!(usdc(&e, &seller).await? - before_seller, 98 * USDC, "gas {gas}: seller paid");
            let after_pool: u128 = view(&e.house, "get_pool", json!({})).await?.as_str().unwrap().parse()?;
            assert_eq!(after_pool - before_pool, 2 * USDC, "gas {gas}: fee reaches house");
        } else {
            assert_eq!(owner, seller.id().as_str());
            assert_eq!(usdc(&e, &buyer).await?, before_buyer, "gas {gas}: rejected buy refunded");
            assert_eq!(usdc(&e, &seller).await?, before_seller);
            assert_ne!(gas, 300, "ordinary max-gas purchase must succeed");
        }
        assert_eq!(view(&e.usdc, "ft_balance_of", json!({"account_id":e.market.id()})).await?, json!("0"));
    }
    Ok(())
}
