// Logical outcomes are deterministic; transaction/block timings and keys are not.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Account, type KeyPairString } from "near-api-js";
import { OneUp, USDC, accountSender, type Deployment } from "@oneup/sdk";
import { inspectDeployment, sourceIdentity, verifyBuildManifest, appInputHash, ROOT } from "./artifacts.ts";
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
const report = {build:verifyBuildManifest(), scope:"SDK/chain/keeper E2E plus app config API; browser inspection is separate", source:sourceIdentity(), checkedAt:new Date().toISOString(), elapsedSeconds:(Date.now()-start)/1000, assertions:["orders filled", "isolated app API", "controlled liquidation", "settled NFT", "USDC recovery", "market ownership transfer", "former owner denied", "buyer claim", "reserve admission", "deployed hashes", "DAO ownership"], mocked:["USDC", "oracle", "swap", "vault", "bridge"], contracts:hashes};
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
