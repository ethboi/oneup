//! Sandbox test of the real wasm: USDC deposit, oracle-priced fills across contracts, liquidation, withdraw.
//! Build first: `./build.sh` (or `cargo near build` in each contract).

use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const USDC: u128 = 1_000_000;
const FEED: &str = "c415de8d2efa7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750";

fn wasm(name: &str) -> Vec<u8> {
    let path = format!("{}/../target/near/{name}/{name}.wasm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|_| panic!("missing {path}; run ./build.sh"))
}

struct Env {
    usdc: Contract,
    oracle: Contract,
    house: Contract,
    owner: Account,
    keeper: Account,
}

async fn setup() -> anyhow::Result<Env> {
    let w = near_workspaces::sandbox().await?;
    let owner = w.root_account()?;
    let keeper = w.dev_create_account().await?;
    let usdc = w.dev_deploy(&wasm("mock_usdc")).await?;
    let oracle = w.dev_deploy(&wasm("mock_oracle")).await?;
    let house = w.dev_deploy(&wasm("oneup_house")).await?;

    usdc.call("new").args_json(json!({"owner": owner.id()})).transact().await?.into_result()?;
    oracle
        .call("new")
        .args_json(json!({"owner": owner.id(), "pusher": keeper.id()}))
        .transact()
        .await?
        .into_result()?;
    house
        .call("new")
        .args_json(json!({"owner": owner.id(), "usdc": usdc.id(), "oracle": oracle.id()}))
        .transact()
        .await?
        .into_result()?;
    owner
        .call(house.id(), "add_market")
        .args_json(json!({"market_id": "NEAR-USD", "feed_id": FEED, "max_leverage": 100}))
        .transact()
        .await?
        .into_result()?;

    // Seed the pool with 100K
    owner
        .call(usdc.id(), "mint")
        .args_json(json!({"receiver_id": owner.id(), "amount": (100_000 * USDC).to_string()}))
        .transact()
        .await?
        .into_result()?;
    owner
        .call(usdc.id(), "mint")
        .args_json(json!({"receiver_id": house.id(), "amount": "0"}))
        .transact()
        .await?
        .into_result()?;
    owner
        .call(usdc.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": house.id(), "amount": (100_000 * USDC).to_string(), "msg": "{\"seed\":{}}"}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    Ok(Env { usdc, oracle, house, owner, keeper })
}

async fn push(e: &Env, cents: i64, publish_time: u64) -> anyhow::Result<()> {
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

async fn view(c: &Contract, method: &str, args: Value) -> anyhow::Result<Value> {
    Ok(c.view(method).args_json(args).await?.json()?)
}

async fn trader(e: &Env, usdc: u128) -> anyhow::Result<Account> {
    let t = e.owner.create_subaccount("trader").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    t.call(e.usdc.id(), "faucet").args_json(json!({"amount": (usdc * USDC).to_string()})).transact().await?.into_result()?;
    t.call(e.usdc.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": e.house.id(), "amount": (usdc * USDC).to_string(), "msg": ""}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(t)
}

#[tokio::test]
async fn open_fill_liquidate_withdraw() -> anyhow::Result<()> {
    let e = setup().await?;
    assert_eq!(view(&e.house, "get_pool", json!({})).await?, json!((100_000 * USDC).to_string()));

    let t = trader(&e, 1_000).await?;
    assert_eq!(view(&e.house, "get_balance", json!({"account_id": t.id()})).await?, json!((1_000 * USDC).to_string()));

    // Open 500 USDC long at 50x
    let order: u64 = t
        .call(e.house.id(), "place_open")
        .args_json(json!({"market_id": "NEAR-USD", "side": "Long", "margin": (500 * USDC).to_string(), "leverage": 50}))
        .transact()
        .await?
        .into_result()?
        .json()?;
    let orders = view(&e.house, "get_orders", json!({"account_id": t.id()})).await?;
    let placed_at = orders[0]["placed_at"].as_u64().unwrap();

    // A price from before the order can't fill it
    push(&e, 500, placed_at).await?;
    let filled: bool = e.keeper.call(e.house.id(), "fill").args_json(json!({"order_id": order})).max_gas().transact().await?.json()?;
    assert!(!filled);

    // The next price can
    push(&e, 500, placed_at + 1).await?;
    let filled: bool = e.keeper.call(e.house.id(), "fill").args_json(json!({"order_id": order})).max_gas().transact().await?.json()?;
    assert!(filled);
    let positions = view(&e.house, "get_positions", json!({"account_id": t.id()})).await?;
    assert_eq!(positions[0]["entry_price"], json!("500000000"));
    let position_id = positions[0]["id"].as_u64().unwrap();

    // Not liquidatable at 4.95; liquidatable at 4.91 (−1.8% × 50 = −90%)
    push(&e, 495, placed_at + 2).await?;
    let ok: bool = e.keeper.call(e.house.id(), "liquidate").args_json(json!({"position_id": position_id})).max_gas().transact().await?.json()?;
    assert!(!ok);
    push(&e, 491, placed_at + 3).await?;
    let ok: bool = e.keeper.call(e.house.id(), "liquidate").args_json(json!({"position_id": position_id})).max_gas().transact().await?.json()?;
    assert!(ok);

    assert_eq!(view(&e.house, "get_pool", json!({})).await?, json!((100_500 * USDC).to_string()));
    assert_eq!(view(&e.house, "get_pending_life", json!({"account_id": t.id()})).await?, json!((500 * USDC).to_string()));

    // Withdraw the other 500
    t.call(e.house.id(), "withdraw")
        .args_json(json!({"amount": (500 * USDC).to_string()}))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    assert_eq!(view(&e.house, "get_balance", json!({"account_id": t.id()})).await?, json!("0"));
    assert_eq!(view(&e.usdc, "ft_balance_of", json!({"account_id": t.id()})).await?, json!((500 * USDC).to_string()));
    Ok(())
}
