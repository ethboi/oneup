"use client";

// Initial pool funding in full (D-22, D-26): what backing gets you, the form and the curve, when it pays back,
// your Backer Lives, the exit, and the risks in plain words.

import { USDC, fmtUsdc, lifeCapPpm, ppmToNumber } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { Backing } from "./Backing";
import { fmtOneup } from "./Header";
import { HealthBar, PixelHeart, PixelLock } from "./Pixel";
import { Icon } from "./Icon";
import { useListings } from "./Sell";

/** `pnpm --filter @oneup/sim backers` for a full $1M round, median of 200 runs, weekly rounds (D-26). */
const PAYBACK = [
  { weekly: "$100K", half: "3.9 years", full: "7.7 years" },
  { weekly: "$250K", half: "81 weeks", full: "3.1 years" },
  { weekly: "$500K", half: "42 weeks", full: "81 weeks" },
  { weekly: "$1M", half: "22 weeks", full: "42 weeks" },
  { weekly: "$2M", half: "13 weeks", full: "23 weeks" },
];

export function BackPage({ go }: { go: (tab: string) => void }) {
  const { o, d, me } = useOneUp();
  const round = usePoll(() => o.backing(), [], 5000);
  const pool = usePoll(() => o.pool(), [], 5000);
  const epoch = usePoll(() => o.epoch(), [], 10_000);
  const mine = (usePoll(() => o.lives(me), [me], 5000) ?? []).filter((l) => l.backer);
  const listings = useListings().filter((l) => l.nft_contract === d.contracts.life && l.token_id.startsWith("b"));
  // the house's result over its last rounds, for a sense of how fast the pot fills here
  const recent = usePoll(
    async () => {
      if (!epoch) return [];
      const ids = Array.from({ length: Math.min(12, epoch.id - 1) }, (_, i) => epoch.id - 1 - i);
      return (await Promise.all(ids.map((e) => o.epochSummary(e)))).filter((x) => x !== null);
    },
    [epoch?.id],
    30_000,
  );

  const backed = round ? BigInt(round.backed) : 0n;
  const target = round ? BigInt(round.target) : 1n;
  const pct = Number((backed * 1000n) / target) / 10;
  const capNow = pool ? ppmToNumber(lifeCapPpm(BigInt(pool))) : null;
  const perDollar = round ? BigInt(round.oneup) : 0n; // quoted for $1
  const houseNet = (recent ?? []).reduce((s, x) => s + BigInt(x!.house_net), 0n);
  const backerPot = (recent ?? []).reduce((s, x) => s + BigInt(x!.lives_pot), 0n) / 3n;

  return (
    <div className="flex flex-col gap-5">
      <section className="case relative overflow-hidden p-5 sm:p-8">
        <div className="flex items-center gap-8">
          <div className="min-w-0 flex-1">
          <p className="label">Initial pool funding</p>
          <h1 className="display mt-2 text-3xl leading-tight sm:text-4xl">Back the house</h1>
          <p className="mt-3 max-w-2xl text-[var(--muted)]">
            The house reserves pool funds to cover the maximum payout on accepted trades. Contribute USDC to this pool
            and receive a Backer Life, which can share in future house profit up to a limit. You also receive $1UP
            locked for 104 rounds, with a share of buyback rewards.
          </p>
          <div className="mt-5 max-w-2xl">
            <div className="num flex items-baseline justify-between text-sm">
              <span>
                <b>${fmtUsdc(backed, 0)}</b> <span className="label">of ${fmtUsdc(target, 0)} raised</span>
              </span>
              <span className="label">{pct.toFixed(1)}%</span>
            </div>
            <div className="mt-1.5">
              <HealthBar value={pct / 100} segments={20} color="var(--primary)" label={`${pct.toFixed(1)}% of the round raised`} />
            </div>
          </div>
          <dl className="num mt-5 grid max-w-2xl grid-cols-3 gap-4">
            <div>
              <dt className="label">Current payout multiplier</dt>
              <dd className="text-xl font-extrabold">{capNow === null ? "…" : `${capNow.toFixed(2)}×`}</dd>
            </div>
            <div>
              <dt className="label">$1UP per $1</dt>
              <dd className="text-xl font-extrabold">{round ? fmtOneup(perDollar.toString()) : "…"}</dd>
            </div>
            <div>
              <dt className="label">$1UP left for backers</dt>
              <dd className="text-xl font-extrabold">{round ? fmtOneup(round.oneup_left) : "…"}</dd>
            </div>
          </dl>
          </div>
          {/* the console's screen, as on About */}
          <div className="bezel hidden shrink-0 p-4 md:block" aria-hidden>
            <div className="lcd flex h-36 w-52 flex-col items-center justify-center gap-2">
              <PixelHeart size={64} />
              <span className="display text-lg text-[var(--lcd-ink)]">BACKER LIFE</span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card icon={<PixelHeart size={26} />} title="A Backer Life">
          A Backer Life has no expiry date, and its payout limit depends on the pool size when it is created. Backer Lives
          share one third of the Extra Life payout pool each round; unused funds can move between the backer and trader shares. The full payout limit may never be reached.
        </Card>
        <Card icon={<PixelLock size={24} />} title="$1UP, locked">
          Receive 10 $1UP for each $1 contributed, locked for 104 rounds. The lock receives a weighted share of buyback rewards,
          separately from your Backer Life payouts.
        </Card>
        <Card icon={<Icon name="store" size={22} />} title="Selling your NFTs">
          Your contribution stays in the trading pool and cannot be withdrawn. You can offer your Backer Life or lock for sale
          on the Market. The price and timing depend on finding a buyer.
        </Card>
      </div>

      <Backing />

      <section className="panel p-5">
        <h2 className="text-lg font-extrabold">Illustrative payout times</h2>
        <p className="label mt-1 max-w-3xl">
          Backer Life payouts depend on house profit. These examples assume $1M in initial funding, weekly rounds and
          house profit averaging 15% of trader losses. Results are medians from 200 simulations. They are illustrations, not forecasts:
          lower profits can leave payout limits unreached indefinitely.
        </p>
        <table className="num mt-3 w-full max-w-xl text-sm">
          <thead>
            <tr className="label text-left">
              <th className="pb-1.5 font-normal">Weekly trader losses</th>
              <th className="pb-1.5 font-normal">50% of payout limit</th>
              <th className="pb-1.5 font-normal">Full payout limit</th>
            </tr>
          </thead>
          <tbody>
            {PAYBACK.map((r) => (
              <tr key={r.weekly} className="border-t border-[var(--line)]">
                <td className="py-1.5 font-bold">{r.weekly}</td>
                <td className="py-1.5">{r.half}</td>
                <td className="py-1.5">{r.full}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {recent && recent.length > 0 && (
          <p className="label num mt-3">
            In this demo, the house made ${fmtUsdc(houseNet > 0n ? houseNet : 0n, 0)} over the last {recent.length} round{recent.length === 1 ? "" : "s"}.
            One third of the Extra Life payout pool for those rounds was approximately ${fmtUsdc(backerPot, 2)}.
          </p>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="text-lg font-extrabold">Your Backer Lives</h2>
          {mine.length === 0 ? (
            <p className="label mt-2">You have no Backer Lives yet. Any you receive will appear here and under Extra Lives.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {mine.map((l) => {
                const owed = BigInt(l.owed);
                const paid = BigInt(l.paid);
                return (
                  <li key={l.token_id} className="num text-sm">
                    <div className="flex justify-between">
                      <b>Backer Life #{l.token_id.slice(1)}</b>
                      <span>
                        ${fmtUsdc(paid, paid < 100n * USDC ? 2 : 0)} <span className="label">of ${fmtUsdc(owed, 0)}</span>
                      </span>
                    </div>
                    <div className="mt-1">
                      <HealthBar value={owed > 0n ? Number(paid) / Number(owed) : 0} label={`Paid ${fmtUsdc(paid)} of ${fmtUsdc(owed)}`} />
                    </div>
                    {BigInt(l.claimable) > 0n && <p className="label mt-1">${fmtUsdc(BigInt(l.claimable))} to claim on the Extra Lives tab</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="panel p-5">
          <h2 className="text-lg font-extrabold">Backer Lives for sale</h2>
          <p className="label mt-1">Browse Backer Lives offered for sale by other owners.</p>
          {listings.length === 0 ? (
            <p className="label mt-3">None listed right now.</p>
          ) : (
            <p className="num mt-3 text-sm">
              <b>{listings.length}</b> listed, from <b>${fmtUsdc(listings.reduce((m, l) => (BigInt(l.price) < m ? BigInt(l.price) : m), BigInt(listings[0].price)), 0)}</b>.
            </p>
          )}
          <button type="button" className="btn btn-ghost mt-3" onClick={() => go("Market")}>
            <Icon name="store" size={16} />
            Open the Market
          </button>
        </section>
      </div>

      <section className="panel p-5">
        <h2 className="text-lg font-extrabold">What to consider</h2>
        <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <li>
            <b>Permanent contribution.</b> <span className="text-[var(--muted)]">Backing can&apos;t be withdrawn: the USDC stays in the pool. Repayment depends on future profit; an early sale needs a buyer and may recover less than the contribution.</span>
          </li>
          <li>
            <b>No repayment deadline.</b> <span className="text-[var(--muted)]">If traders win more than they lose, the house makes nothing and Backer Lives aren&apos;t paid.</span>
          </li>
          <li>
            <b>Capped.</b> <span className="text-[var(--muted)]">A Backer Life cannot pay more than its original limit, which is at most 2× its face value. Rewards from the separate $1UP lock have no fixed payout cap.</span>
          </li>
          <li>
            <b>If OneUp winds down.</b>{" "}
            <span className="text-[var(--muted)]">
              The proposed shutdown process would pay Backer Lives and trader Lives from the pool before distributing any remainder to lock holders. This process is not implemented yet.
            </span>
          </li>
          <li>
            <b>A proof of concept.</b> <span className="text-[var(--muted)]">These contracts haven&apos;t been audited. This demo runs on a local chain with test money.</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-5">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--panel-2)]">{icon}</span>
      <h3 className="mt-3 font-extrabold">{title}</h3>
      <p className="mt-1 text-sm text-[var(--muted)]">{children}</p>
    </div>
  );
}
