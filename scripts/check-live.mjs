#!/usr/bin/env node
// Reads OneUp's live NEAR testnet deployment and checks what the README says about it.
// It needs only Node 18 or newer: no install, no wallet and no keys. It sends no transactions.
//
//   node scripts/check-live.mjs
//
// Exit code 0 means every check passed. ONEUP_LIVE_RPC replaces the public nodes with your own.
import { pathToFileURL } from "node:url";

export const ROOT = "v5.oneupmarkets.testnet";
const NAMES = ["house", "life", "oneup", "ve", "market", "usdc", "oracle", "swap", "vault"];
const contract = name => `${name}.${ROOT}`;
const NODES = process.env.ONEUP_LIVE_RPC
  ? [process.env.ONEUP_LIVE_RPC]
  : ["https://near-testnet.drpc.org/", "https://test.rpc.fastnear.com/", "https://testnet-rpc.intea.rs/", "https://rpc.testnet.near.org/"];

// From epoch_payout in contracts/math/src/lib.rs: half the surplus is paid out, 60% of that to Lives and 30% to
// buybacks. Whatever Lives can't take because they're fully paid goes to buybacks instead.
const PAYOUT_PPM = 500_000n;
const LIVES_SHARE_PPM = 600_000n;
const BUYBACK_SHARE_PPM = 300_000n;
const PPM = 1_000_000n;
const NO_CODE = "11111111111111111111111111111111";

const big = value => BigInt(value ?? 0);
const usdc = value => `$${(Number(big(value)) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sum = (items, read) => items.reduce((total, item) => total + big(read(item)), 0n);
const paidAsTheContractSays = round => {
  const payout = big(round.surplus) * PAYOUT_PPM / PPM;
  const livesShare = payout * LIVES_SHARE_PPM / PPM;
  const pot = big(round.lives_pot);
  return pot <= livesShare && big(round.buyback_pot) === payout * BUYBACK_SHARE_PPM / PPM + (livesShare - pot);
};

/** Turns one snapshot of the chain into results. Reads nothing itself, so a test can feed it a broken chain. */
export function evaluate(s) {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });

  const locked = s.accounts.every(a => a.codeHash !== NO_CODE && a.keys === 0);
  check("All nine contracts are deployed and nobody holds a key to them", locked,
    locked ? `${s.accounts.length} contracts, 0 access keys. None of them has a method that deploys new code.`
      : `Not locked: ${s.accounts.filter(a => a.codeHash === NO_CODE || a.keys !== 0).map(a => a.name).join(", ")}`);

  const maxAge = s.params.max_price_age_s + 60;
  const ages = s.markets.map(m => ({ id: m.id, age: s.now - m.price.publish_time, price: Number(m.price.price) * 10 ** m.price.expo }));
  check("Prices are live", ages.length === 3 && ages.every(a => a.age <= maxAge),
    ages.map(a => `${a.id} ${a.price.toLocaleString("en-US", { maximumFractionDigits: 4 })} (${a.age}s old)`).join(", "));

  const last = s.rounds.at(-1);
  const roundAge = s.now - s.epoch.started_at;
  check("Rounds keep closing", s.rounds.length > 0 && roundAge <= s.params.epoch_length_s * 2 && last?.ended_at === s.epoch.started_at,
    `Round ${s.epoch.id} opened ${Math.round(roundAge / 60)} min ago; ${s.rounds.length} rounds have closed.`);

  const volume = big(s.epoch.losses) + big(s.epoch.payouts) + big(last?.losses) + big(last?.payouts);
  check("Trades are happening", volume > 0n,
    `${usdc(volume)} of losses and profits in this round and the last, ${s.positions.length} positions open.`);

  const liability = sum(s.solvency.markets, m => m.liability);
  const fits = s.solvency.markets.every(m => big(m.liability) <= big(m.capacity)) && liability <= big(s.solvency.pool);
  check("Every open position's worst case fits inside the pool", fits,
    `${usdc(liability)} worst case against a ${usdc(s.solvency.pool)} pool.`);

  const noProfitNoLives = s.rounds.every(r => big(r.house_net) > 0n || r.lives_minted === 0);
  const faces = new Map();
  for (const life of s.lives) if (!life.backer) faces.set(life.epoch, (faces.get(life.epoch) ?? 0n) + big(life.face));
  const sized = s.rounds.every(r => (faces.get(r.epoch) ?? 0n) <= big(r.house_net));
  const profitable = s.rounds.filter(r => big(r.house_net) > 0n).length;
  check("Lives only come from house profit, and never add up to more than it", noProfitNoLives && sized,
    `${profitable} of ${s.rounds.length} closed rounds made a profit and minted ${s.rounds.reduce((n, r) => n + r.lives_minted, 0)} Lives; the rest minted none.`);

  const owedRight = s.lives.every(l => big(l.owed) === big(l.face) * big(l.cap_ppm) / PPM && big(l.paid) <= big(l.owed));
  const earned = s.lives.filter(l => !l.backer);
  check("Each Life is owed its size times the round's cap, and has never been paid more", owedRight,
    `${earned.length} Lives earned by traders can pay up to ${usdc(sum(earned, l => l.owed))} and have been paid ${usdc(sum(earned, l => l.paid))}. ${s.lives.length - earned.length} more for backing the pool.`);

  const sharesRight = s.rounds.every(paidAsTheContractSays);
  const pots = sum(s.rounds, r => r.lives_pot);
  check("The money Lives received is exactly what the rounds paid them", sharesRight && pots === big(s.livesState.lives_paid),
    `${usdc(pots)} across all closed rounds, and the house's own total says ${usdc(s.livesState.lives_paid)}. It pays out only from surplus above the pool's reserve.`);

  const allocated = sum(s.lives, l => l.paid);
  const claimable = sum(s.lives, l => l.claimable);
  const backed = big(s.lifeUsdc) >= big(s.lifeHeld) && big(s.lifeHeld) >= claimable && allocated <= big(s.livesState.lives_paid);
  check("USDC waiting to be claimed is really in the Life NFT contract", backed,
    `${usdc(claimable)} claimable, ${usdc(s.lifeUsdc)} held. ${usdc(big(s.livesState.lives_paid) - big(s.lifeUsdc))} has been claimed.`);

  const moved = s.lives.filter(l => !l.backer && l.token_id.split(":").slice(1).join(":") !== l.owner_id);
  check("Lives change hands, and the buyer collects", moved.length > 0 && moved.some(l => big(l.paid) > 0n),
    `${moved.length} Lives are owned by someone other than the trader who earned them; ${s.listings} listings are on the market now.`);

  const onChainArt = t => (t.metadata?.media ?? "").startsWith("data:image/svg+xml");
  check("The NFT pictures are stored on chain", s.lifeTokens.length > 0 && s.lifeTokens.every(onChainArt) && s.lockTokens.every(onChainArt),
    `${s.lifeTokens.length} Lives and ${s.lockTokens.length} $1UP locks, each with its picture in the contract.`);

  return results;
}

/** Plain facts the checks can't prove or that a reader should weigh, computed from the same snapshot. */
export function disclosures(s) {
  const ours = id => id === ROOT || id.endsWith(`.${ROOT}`);
  // guest accounts are made in a browser by anyone, the author included (app/src/lib/server/guest.ts)
  const guest = id => id.endsWith(".guests.oneupmarkets.testnet");
  const traders = new Set(s.positions.map(p => p.owner));
  const holders = new Set(s.lives.map(l => l.owner_id));
  const everyone = new Set([...traders, ...holders]);
  const outside = [...everyone].filter(id => !ours(id) && !guest(id));
  const guests = [...everyone].filter(guest);
  return [
    `Test money: USDC here is a test token with a faucet, and the swap and vault are mocks.`,
    `Prices: the oracle is a mock, and the author's keeper feeds it Binance prices from their own machine.`,
    `Who's trading: ${outside.length || guests.length ? `${outside.length} outside accounts and ${guests.length} guest accounts (made in a browser by anyone, the author included) among the open positions and Life owners; the rest are the author's bots.` : "every open position and Life owner right now is the author's bots or operator."}`,
    `Control: nobody can change the code, but ${s.owner} can still halt markets, change the oracle, keeper and parameters, and move the pool's idle USDC (README: Who controls what on testnet).`,
    `Not audited. The DAO, Intents, one-tap trading and agents run in the local demo, not here.`,
  ];
}

async function view(account, method, args = {}) {
  const result = await query({ request_type: "call_function", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(result.result).toString() || "null");
}

async function query(params) {
  let failure;
  for (let attempt = 0; attempt < 12; attempt++) {
    const node = NODES[attempt % NODES.length];
    try {
      const response = await fetch(node, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "check-live", method: "query", params: { finality: "final", ...params } }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw Error(`${node} answered HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw Error(`${node}: ${body.error.message ?? JSON.stringify(body.error)}`);
      if (body.result?.error) throw Error(`${params.account_id}: ${body.result.error}`);
      return body.result;
    } catch (error) {
      failure = error;
      await new Promise(done => setTimeout(done, 400 * (attempt + 1)));
    }
  }
  throw Error(`No public node answered (${failure?.message}). They rate-limit: wait a minute, or set ONEUP_LIVE_RPC to your own node.`);
}

async function inBatches(items, read, size = 4) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(read)));
  return out;
}

async function allTokens(account) {
  const supply = Number(await view(account, "nft_total_supply"));
  const starts = Array.from({ length: Math.ceil(supply / 50) }, (_, i) => i * 50);
  return (await inBatches(starts, from => view(account, "nft_tokens", { from_index: String(from), limit: 50 }))).flat();
}

// Stops at the owner's count: the contract refuses a page that starts at or past it, which is where an owner
// holding an exact multiple of the page size would otherwise be asked for one page too many.
export async function readOwned(count, read, size = 100) {
  const items = [];
  while (items.length < count) {
    const page = await read(items.length, size);
    items.push(...page);
    if (page.length < size) break;
  }
  return items;
}

async function readLives(account, owner) {
  const count = Number(await view(account, "nft_supply_for_owner", { account_id: owner }));
  return readOwned(count, (from, limit) => view(account, "lives_for_owner", { account_id: owner, from_index: String(from), limit }));
}

async function snapshot() {
  const house = contract("house"), life = contract("life");
  const accounts = await inBatches(NAMES, async name => {
    const account = await query({ request_type: "view_account", account_id: contract(name) });
    const keys = await query({ request_type: "view_access_key_list", account_id: contract(name) });
    return { name, codeHash: account.code_hash, keys: keys.keys.length };
  });
  const epoch = await view(house, "get_epoch");
  const closing = await view(house, "get_closing");
  const ids = Array.from({ length: epoch.id - 1 }, (_, i) => i + 1);
  const rounds = (await inBatches(ids, id => view(house, "get_epoch_summary", { epoch: id }))).filter(Boolean);
  const [params, owner, solvency, listedMarkets, positions, livesState, lifeHeld, lifeUsdc, listings] = await Promise.all([
    view(house, "get_params"), view(house, "get_owner"), view(house, "get_solvency"), view(house, "get_markets"),
    view(house, "list_positions", { from_index: 0, limit: 500 }), view(house, "get_lives_state"), view(life, "held"),
    view(contract("usdc"), "ft_balance_of", { account_id: life }), view(contract("market"), "get_listings", { from_index: 0, limit: 100 }),
  ]);
  const markets = await inBatches(listedMarkets, async m => ({ id: m.id, price: await view(contract("oracle"), "get_price", { price_identifier: m.feed_id }) }));
  const lifeTokens = await allTokens(life);
  const lockTokens = await allTokens(contract("ve"));
  const lives = (await inBatches([...new Set(lifeTokens.map(t => t.owner_id))], owner => readLives(life, owner))).flat();
  const after = await view(house, "get_epoch");
  return {
    now: Math.floor(Date.now() / 1000), settled: !closing && after.id === epoch.id,
    accounts, epoch, rounds, params, owner: owner[0], solvency, markets, positions, livesState, lifeHeld, lifeUsdc,
    listings: listings.length, lifeTokens, lockTokens, lives,
  };
}

async function main() {
  console.log(`OneUp live check: reading ${ROOT} on NEAR testnet. Read-only; no wallet or keys.\n`);
  let s = await snapshot();
  // A round closing while we read would make the totals disagree for a moment, so read again once it's done.
  for (let tries = 0; !s.settled && tries < 4; tries++) {
    console.log("A round is closing right now. Reading again in 30 seconds.");
    await new Promise(done => setTimeout(done, 30_000));
    s = await snapshot();
  }
  const results = evaluate(s);
  for (const { name, pass, detail } of results) console.log(`${pass ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
  console.log("\nWhat this doesn't prove:");
  for (const line of disclosures(s)) console.log(`  ${line}`);
  console.log(`\nSee for yourself: https://testnet.nearblocks.io/address/${contract("life")}`);
  const failed = results.filter(r => !r.pass).length;
  console.log(failed ? `\n${failed} of ${results.length} checks failed.` : `\nAll ${results.length} checks passed.`);
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Couldn't finish the check: ${error.message}`); process.exitCode = 2; });
}
