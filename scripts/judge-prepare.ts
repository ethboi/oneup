// Gives a fresh judge chain something to show on the first screen: the demo trader and bot3 each lose a trade (a
// controlled price drop liquidates both), the round closes, and both get a Life NFT with USDC to claim. bot3
// claims its USDC and lists the Life on the Market for what's left, its future payouts, for the demo trader to
// buy. Prepared, scripted state: judge-demo.ts discloses it in prepared.json. bot3 because test:judge trades as
// bot1, bot2 and demo, and the AI agent is bot12.
import { Account, type KeyPairString } from "near-api-js";
import { OneUp, USDC, accountSender, type Deployment, type LifeInfo } from "@oneup/sdk";

const MARKET = "NEAR-USD";
const MARGIN = 500n * USDC;
const LEVERAGE = 50;

export type Prepared = {
  demoLife: LifeInfo;
  listing: { seller: string; tokenId: string; priceAtomic: string; claimedAtomic: string; remainingLimitAtomic: string };
};

export async function prepareJudgeChain(d: Deployment, controlUrl: string, say: (line: string) => void): Promise<Prepared> {
  const o = new OneUp(d);
  const send = (a: { id: string; key: string }) => o.calls(accountSender(new Account(a.id, o.provider, a.key as KeyPairString)));
  const seller = d.bots[2];
  const traders = [d.demo, seller];
  async function until<T>(what: string, load: () => Promise<T | undefined | false>, timeout = 150_000): Promise<T> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = await load();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw Error(`Timed out waiting for ${what}`);
  }
  async function steer(price: number) {
    const r = await fetch(`${controlUrl}/price`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ market: MARKET, price }) });
    if (!r.ok) throw Error(`The keeper refused the price ${price}: ${await r.text()}`);
  }

  if ((await Promise.all(traders.map((t) => o.positions(t.id)))).flat().length > 0) throw Error("demo or bot3 already has an open position");
  const before = new Map(await Promise.all(traders.map(async (t) => [t.id, new Set((await o.lives(t.id)).map((l) => l.token_id))] as const)));
  // the keeper starts its price control a moment after the chain is up
  const start = await until("the keeper's price control", async () => {
    const prices = await fetch(`${controlUrl}/prices`).then((r) => r.json()).catch(() => undefined);
    const p = Number(prices?.[MARKET]);
    return p > 0 ? p : undefined;
  }, 60_000);

  say(`  · demo and ${seller.id} each open a ${LEVERAGE}× long on ${MARKET} with $${MARGIN / USDC}`);
  for (const t of traders) await send(t).deposit(MARGIN);
  await until("a price the house will trade on", async () => (await o.quoteOpen(MARKET, "Long", MARGIN, LEVERAGE)).allowed);
  for (const t of traders) await send(t).placeOpen(MARKET, "Long", MARGIN, LEVERAGE);
  const positions = await until("both fills", async () => {
    const ps = (await Promise.all(traders.map((t) => o.positions(t.id)))).flat();
    return ps.length === traders.length ? ps : undefined;
  });

  // 2% under the lower entry is past a 50× position's liquidation price; then the price goes back
  say("  · the price drops 2% and the keeper liquidates both");
  await steer(Math.min(...positions.map((p) => Number(p.entry_price) / 1e8)) * 0.98);
  await until("the liquidations", async () => (await Promise.all(traders.map((t) => o.positions(t.id)))).flat().length === 0);
  await steer(start);

  say(`  · the round closes (rounds are ${d.epochLengthS ?? 45} seconds) and both get a Life NFT`);
  const life = (id: string) =>
    until(`${id}'s Life NFT with USDC to claim`, async () => (await o.lives(id)).find((l) => !before.get(id)!.has(l.token_id) && !l.backer && BigInt(l.claimable) > 0n));
  const demoLife = await life(d.demo.id);
  const sellerLife = await life(seller.id);

  // bot3 takes the cash and sells the rest: a buyer pays for future payouts, which may be zero. A scripted
  // asking price of a fifth of the remaining payout limit, in whole dollars.
  say(`  · ${seller.id} claims its Life's USDC and lists the Life for its future payouts`);
  await send(seller).claimLives([sellerLife.token_id]);
  const claimed = await until("the claim", async () => {
    const l = await o.lifeInfo(sellerLife.token_id);
    return l && BigInt(l.claimable) === 0n ? l : undefined;
  });
  const remaining = BigInt(claimed.owed) - BigInt(claimed.paid);
  const price = (remaining / 5n / USDC) * USDC;
  await send(seller).list(d.contracts.life, sellerLife.token_id, price);
  await until("the listing", async () => (await o.listings()).some((l) => l.token_id === sellerLife.token_id));
  return {
    demoLife,
    listing: { seller: seller.id, tokenId: sellerLife.token_id, priceAtomic: price.toString(), claimedAtomic: sellerLife.claimable, remainingLimitAtomic: remaining.toString() },
  };
}
