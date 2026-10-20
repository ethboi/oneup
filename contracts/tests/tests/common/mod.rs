//! Shared sandbox setup: mock USDC, mock oracle, Extra Life and the house, with a 100K seed.
#![allow(dead_code)]

use near_workspaces::types::NearToken;
use near_workspaces::{network::Sandbox, Account, Contract, Worker};
use serde_json::{json, Value};

pub const USDC: u128 = 1_000_000;
pub const FEED: &str = "c415de8d2efa7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750";

pub fn wasm(name: &str) -> Vec<u8> {
    let path = format!("{}/../target/near/{name}/{name}.wasm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|_| panic!("missing {path}; run ./build.sh"))
}

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub usdc: Contract,
    pub oracle: Contract,
    pub life: Contract,
    pub house: Contract,
    pub oneup: Contract,
    pub ve: Contract,
    pub owner: Account,
    pub keeper: Account,
}

pub fn usd(x: u128) -> String {
    (x * USDC).to_string()
}

pub async fn setup(epoch_length_s: u64) -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.root_account()?;
    let keeper = worker.dev_create_account().await?;
    let usdc = worker.dev_deploy(&wasm("mock_usdc")).await?;
    let oracle = worker.dev_deploy(&wasm("mock_oracle")).await?;
    let life = worker.dev_deploy(&wasm("oneup_extra_life")).await?;
    let house = worker.dev_deploy(&wasm("oneup_house")).await?;
    let oneup = worker.dev_deploy(&wasm("oneup_token")).await?;
    let ve = worker.dev_deploy(&wasm("oneup_ve")).await?;

    usdc.call("new").args_json(json!({"owner": owner.id()})).transact().await?.into_result()?;
    oracle.call("new").args_json(json!({"owner": owner.id(), "pusher": keeper.id()})).transact().await?.into_result()?;
    life.call("new")
        .args_json(json!({"owner": owner.id(), "house": house.id(), "usdc": usdc.id()}))
        .transact()
        .await?
        .into_result()?;
    let params = json!({
        "leverage_hard_limit": 250, "min_margin": usd(1), "min_hold_s": 60, "fill_window_s": 30,
        "max_price_age_s": 60, "max_conf_ppm": "10000", "solvency_both_sides": true,
        "epoch_length_s": epoch_length_s
    });
    house
        .call("new")
        .args_json(json!({"owner": owner.id(), "usdc": usdc.id(), "oracle": oracle.id(), "params": params}))
        .transact()
        .await?
        .into_result()?;
    owner.call(house.id(), "set_life").args_json(json!({"life": life.id()})).transact().await?.into_result()?;
    // $1UP: 900M to the house; the owner stands in for the Rhea seed and the treasury
    oneup
        .call("new")
        .args_json(json!({"house": house.id(), "rhea_seed": owner.id(), "treasury": owner.id()}))
        .transact()
        .await?
        .into_result()?;
    ve.call("new")
        .args_json(json!({"owner": owner.id(), "house": house.id(), "oneup": oneup.id()}))
        .transact()
        .await?
        .into_result()?;
    owner
        .call(house.id(), "set_token_and_ve")
        .args_json(json!({"oneup": oneup.id(), "ve": ve.id()}))
        .transact()
        .await?
        .into_result()?;
    register(&owner, &oneup, ve.id().as_str()).await?;
    owner
        .call(house.id(), "add_market")
        .args_json(json!({"market_id": "NEAR-USD", "feed_id": FEED, "max_leverage": 100}))
        .transact()
        .await?
        .into_result()?;

    // register the contracts on USDC, then seed the pool with 100K
    for id in [house.id(), life.id()] {
        owner.call(usdc.id(), "mint").args_json(json!({"receiver_id": id, "amount": "0"})).transact().await?.into_result()?;
    }
    owner.call(usdc.id(), "mint").args_json(json!({"receiver_id": owner.id(), "amount": usd(100_000)})).transact().await?.into_result()?;
    owner
        .call(usdc.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": house.id(), "amount": usd(100_000), "msg": "{\"seed\":{}}"}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    Ok(Env { worker, usdc, oracle, life, house, oneup, ve, owner, keeper })
}

pub async fn push(e: &Env, cents: i64, publish_time: u64) -> anyhow::Result<()> {
    e.keeper
        .call(e.oracle.id(), "push_prices")
        .args_json(json!({"updates": [{
            "feed_id": FEED, "price": cents * 1_000_000, "conf": 0, "expo": -8, "publish_time": publish_time
        }]}))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

pub async fn view(c: &Contract, method: &str, args: Value) -> anyhow::Result<Value> {
    Ok(c.view(method).args_json(args).await?.json()?)
}

pub async fn trader(e: &Env, name: &str, usdc: u128) -> anyhow::Result<Account> {
    let t = e.owner.create_subaccount(name).initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    t.call(e.usdc.id(), "faucet").args_json(json!({"amount": usd(usdc)})).transact().await?.into_result()?;
    t.call(e.usdc.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": e.house.id(), "amount": usd(usdc), "msg": ""}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(t)
}

/// Places an open and fills it with a price one second after the order. Returns (position id, placed_at).
pub async fn open(e: &Env, t: &Account, side: &str, margin: u128, leverage: u32, cents: i64) -> anyhow::Result<(u64, u64)> {
    let order: u64 = t
        .call(e.house.id(), "place_open")
        .args_json(json!({"market_id": "NEAR-USD", "side": side, "margin": usd(margin), "leverage": leverage}))
        .transact()
        .await?
        .into_result()?
        .json()?;
    let orders = view(&e.house, "get_orders", json!({"account_id": t.id()})).await?;
    let placed_at = orders.as_array().unwrap().iter().find(|o| o["id"] == order).unwrap()["placed_at"].as_u64().unwrap();
    push(e, cents, placed_at + 1).await?;
    let filled: bool = e.keeper.call(e.house.id(), "fill").args_json(json!({"order_id": order})).max_gas().transact().await?.json()?;
    assert!(filled, "fill refused");
    let positions = view(&e.house, "get_positions", json!({"account_id": t.id()})).await?;
    Ok((positions.as_array().unwrap().last().unwrap()["id"].as_u64().unwrap(), placed_at))
}

/// NEP-145 storage registration on a token.
pub async fn register(payer: &Account, token: &Contract, account: &str) -> anyhow::Result<()> {
    payer
        .call(token.id(), "storage_deposit")
        .args_json(json!({"account_id": account}))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

/// Calls `close_epoch` until it returns "closed". Returns the steps.
pub async fn close_epoch(e: &Env) -> anyhow::Result<Vec<String>> {
    let mut steps = vec![];
    loop {
        let r: String = e.keeper.call(e.house.id(), "close_epoch").args_json(json!({})).max_gas().transact().await?.into_result()?.json()?;
        steps.push(r.clone());
        if r == "closed" || steps.len() > 10 {
            return Ok(steps);
        }
    }
}
