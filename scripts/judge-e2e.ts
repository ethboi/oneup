// Logical outcomes are deterministic; transaction/block timings and keys are not.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Account, type KeyPairString } from "near-api-js";
import { OneUp, USDC, accountSender, type Deployment } from "@oneup/sdk";
import { inspectDeployment, sourceIdentity, verifyBuildManifest, appInputHash, ROOT } from "./artifacts.ts";
import { intentsBalances, payFromChain } from "../app/src/lib/intents.ts";
const config = process.env.ONEUP_CONFIG;
assert.ok(config && resolve(config).includes('/.judge/'), "Use only the isolated judge configuration printed by pnpm demo:judge");
const d: Deployment = JSON.parse(readFileSync(config, "utf8"));
assert.equal(d.network, "localnet");
assert.equal(new URL(d.rpcUrl).hostname, "127.0.0.1");
const profile = JSON.parse(readFileSync(resolve(dirname(config), "judge-profile.json"),"utf8"));
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(profile.appUrl));
assert.equal(d.rpcUrl, profile.rpcUrl ?? "http://127.0.0.1:3130");
const controlUrl = profile.controlUrl ?? "http://127.0.0.1:8887";
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(controlUrl));
assert.equal(appInputHash(resolve(dirname(config),"app")), appInputHash(), "judge app snapshot must match current app inputs");
const appConfig = await fetch(`${profile.appUrl}/api/config`).then(r=>r.json());
assert.equal(appConfig.contracts.house,d.contracts.house);
assert.equal(appConfig.rpcUrl,d.rpcUrl);
const o = new OneUp(d), start = Date.now();
const sender = (a: {id:string;key:string}) => o.calls(accountSender(new Account(a.id, o.provider, a.key as KeyPairString)));
const seller = d.bots[0], buyer = d.demo, a = sender(seller), b = sender(buyer);
// The browser gets a separate, disclosed prepared Life. Its listing, purchase and claim happen through the UI.
const browserSeller = process.env.ONEUP_PREPARE_BROWSER === "1" ? d.bots[1] : undefined;
assert.ok(process.env.ONEUP_PREPARE_BROWSER !== "1" || browserSeller, "Browser preparation needs a second bot account");
const traders = [seller, buyer, ...(browserSeller ? [browserSeller] : [])];
const transactions = traders.map(sender);
async function until<T>(name: string, load: () => Promise<T | undefined | false>, timeout = 110000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const v = await load(); if (v) return v; await new Promise(r => setTimeout(r, 1000)); }
  throw Error(`Timeout: ${name}`);
}
const priorSellerLives = new Set((await o.lives(seller.id)).map(l=>l.token_id));
const priorBuyerLives = new Set((await o.lives(buyer.id)).map(l=>l.token_id));
const priorBrowserLives = new Set(browserSeller ? (await o.lives(browserSeller.id)).map(l => l.token_id) : []);
assert.equal((await Promise.all(traders.map(t => o.positions(t.id)))).flat().length, 0, "finish existing isolated positions before rehearsing again");
for (const tx of transactions) await tx.deposit(1000n * USDC);
await until("initial price", async () => { const q = await o.quoteOpen("NEAR-USD", "Long", 500n * USDC, 50); return q.allowed ? q : undefined; });
for (const tx of transactions) await tx.placeOpen("NEAR-USD", "Long", 500n * USDC, 50);
const pos = await until("all order fills", async () => { const ps = (await Promise.all(traders.map(t => o.positions(t.id)))).flat(); return ps.length === traders.length ? ps : undefined; });
const price = Math.min(...pos.map(p => Number(p.entry_price)/1e8)) * .98;
const steer = await fetch(`${controlUrl}/price`, {method:"POST",headers:{"content-type":"application/json"}, body:JSON.stringify({market:"NEAR-USD",price})}); assert.ok(steer.ok);
await until("liquidation", async () => (await Promise.all(traders.map(t => o.positions(t.id)))).flat().length === 0);
const sellerLife = await until("seller NFT and USDC allocation", async () => (await o.lives(seller.id)).find(l => !priorSellerLives.has(l.token_id) && !l.backer && BigInt(l.claimable) > 0n));
const buyerLife = await until("buyer NFT", async () => (await o.lives(buyer.id)).find(l => !priorBuyerLives.has(l.token_id) && !l.backer && BigInt(l.claimable) > 0n));
const balance = BigInt(await o.usdcBalance(buyer.id));
await b.claimLives([buyerLife.token_id]);
assert.ok(BigInt(await o.usdcBalance(buyer.id)) > balance, "loss NFT pays actual test USDC");
await a.list(d.contracts.life, sellerLife.token_id, 10n * USDC);
const listing = (await o.listings()).find(l => l.nft_contract === d.contracts.life && l.token_id === sellerLife.token_id);
assert.ok(listing && BigInt(listing.price) === 10n * USDC, "listed at the asking price");
await b.buy(listing);
assert.ok(!(await o.lives(seller.id)).some(l => l.token_id === sellerLife.token_id));
assert.ok((await o.lives(buyer.id)).some(l => l.token_id === sellerLife.token_id));
await assert.rejects(a.claimLives([sellerLife.token_id]), /Smart contract panicked: Not your token/);
const beforeClaim = BigInt(await o.usdcBalance(buyer.id));
await b.claimLives([sellerLife.token_id]);
assert.ok(BigInt(await o.usdcBalance(buyer.id)) > beforeClaim, "buyer inherits claim rights");
const s = await o.solvency(); assert.ok(BigInt(s.pool) >= BigInt(s.liability));
assert.equal((await o.quoteOpen("NEAR-USD", "Long", 1000000n * USDC, 50)).allowed, false, "oversized risk refused");
const hashes = await inspectDeployment(d); assert.ok(hashes.every(h => h.matches));
// D-20: the Sputnik DAO owns the house, the Life NFTs (which house mints and pays them) and the oracle (who pushes prices)
assert.ok(d.contracts.dao, "the local deployment has a DAO");
assert.equal((await o.view<[string, string | null]>(d.contracts.house, "get_owner"))[0], d.contracts.dao);
assert.equal(await o.view<string>(d.contracts.life, "get_owner"), d.contracts.dao);
assert.equal(await o.view<string>(d.contracts.oracle, "get_owner"), d.contracts.dao);
// D-21: paying from another chain with NEAR Intents, through the same code the app runs in the browser. The
// bridge is simulated; the Verifier is the official build, the intent is signed with the official SDK and
// the app's solver fills it.
assert.ok(d.intents, "the local deployment has NEAR Intents");
const payer = d.bots[6], payerAccount = new Account(payer.id, o.provider, payer.key as KeyPairString);
const eth = d.intents.assets.find(x => x.symbol === "ETH")!;
const held = async (account: string, token: string) => (await intentsBalances(o, d, account))[token] ?? 0n;
// USDC the Verifier holds: it falls only when a withdrawal pays the house (the house's own USDC also moves to and from its vault)
const inVerifier = async () => BigInt(await o.usdcBalance(d.intents!.verifier));
const pay = (usdc: bigint, margin: bigint) => payFromChain({ o, d, main: payerAccount, keyString: payer.key, asset: eth, usdc, api: profile.appUrl,
  then: { kind: "open", market_id: "NEAR-USD", side: "Long", margin, leverage: 5 } });
// a trade can't be closed in its first minute, so each run leaves its small trade open and tells its own apart by id
const priorTrades = new Set((await o.positions(payer.id)).map(x => x.id));
assert.equal((await o.orders(payer.id)).length, 0, "the paying account has no order waiting");
const free = BigInt(await o.balance(payer.id)), verifierUsdc = await inVerifier(), solverUsdc = await held(d.intents.solver.id, d.contracts.usdc), solverEth = await held(d.intents.solver.id, eth.token);
const paid = await pay(200n * USDC, 200n * USDC);
assert.ok(paid.tx, "the solver's transaction is on the chain");
assert.equal(await held(payer.id, eth.token), 0n, "all the bridged ETH was paid");
const ethPaid = await held(d.intents.solver.id, eth.token) - solverEth;
assert.ok(ethPaid > 0n, "the solver received the ETH");
assert.equal(solverUsdc - await held(d.intents.solver.id, d.contracts.usdc), 200n * USDC, "the solver paid exactly the USDC");
assert.equal(verifierUsdc - await inVerifier(), 200n * USDC, "the USDC left the Verifier for the house");
const paidFor = await until("trade opened by the intent", async () => (await o.positions(payer.id)).find(x => !priorTrades.has(x.id)));
assert.equal(BigInt(paidFor.margin), 200n * USDC); assert.equal(paidFor.leverage, 5); assert.equal(paidFor.side, "Long");
assert.equal(BigInt(await o.balance(payer.id)), free, "the trade took only what the intent brought");
// An intent that asks for a bigger trade than it pays for: the house keeps the deposit for the account and places no order.
const refused = await pay(50n * USDC, 100n * USDC);
assert.ok(refused.logs.some(l => l.includes("Order not placed: margin above the deposit")), "the house says why it placed no order");
assert.equal((await o.orders(payer.id)).length, 0, "no order for more than the deposit");
assert.equal((await o.positions(payer.id)).length, priorTrades.size + 1);
assert.equal(BigInt(await o.balance(payer.id)) - free, 50n * USDC, "the deposit is in the free balance");
assert.equal(verifierUsdc - await inVerifier(), 250n * USDC);
const report = {build:verifyBuildManifest(), scope:"SDK/chain/keeper E2E plus app config API; browser inspection is separate", source:sourceIdentity(), checkedAt:new Date().toISOString(), elapsedSeconds:(Date.now()-start)/1000, assertions:["orders filled", "isolated app API", "controlled liquidation", "settled NFT", "USDC recovery", "market ownership transfer", "former owner denied", "buyer claim", "reserve admission", "deployed hashes", "DAO ownership", "Intents payment opens a trade", "Intents trade above its deposit refused"], mocked:["USDC", "oracle", "swap", "vault", "bridge"], contracts:hashes};
if (browserSeller) {
  const browserLife = await until("prepared browser Life with allocated USDC", async () => (await o.lives(browserSeller.id)).find(l => !priorBrowserLives.has(l.token_id) && !l.backer && BigInt(l.claimable) > 0n));
  // Public fields only. Never serialize d: it includes local throwaway private keys.
  writeFileSync(resolve(dirname(config), "browser-fixture.json"), JSON.stringify({
    source: sourceIdentity(), appUrl: profile.appUrl, rpcUrl: d.rpcUrl, contracts: d.contracts,
    seller: browserSeller.id, buyer: buyer.id, tokenId: browserLife.token_id,
    askingPriceUsdc: "12", preparedClaimableAtomic: browserLife.claimable,
    preparedState: "A funded test trader was liquidated through the SDK and controlled oracle before browser testing. The sale price is scripted and does not establish demand.",
  }, null, 2));
}
writeFileSync(resolve(dirname(config), "e2e.json"), JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
