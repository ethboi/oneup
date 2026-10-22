"use client";

// "Can't go bust": the pool against the worst case it must cover (every open position's max win, both
// sides, decision D-1), per-market liability against its cap (half the pool, D-14), and the epoch history.

import { fmtUsdc, ppmToNumber, type EpochSummary } from "@oneup/sdk";
import { Fairness } from "./Fairness";
import { fmtUsd } from "./Header";
import { useOneUp, usePoll } from "@/lib/oneup";
import { Icon } from "./Icon";
import { Governance } from "./Governance";
import { PageTitle } from "./ui";

const big = (x?: string) => (x === undefined ? 0n : BigInt(x));
const pct = (a: bigint, b: bigint) => (b === 0n ? 0 : Number((a * 10_000n) / b) / 100);

export function Solvency() {
  const { o } = useOneUp();
  const s = usePoll(() => o.solvency(), []);
  const epoch = usePoll(() => o.epoch(), []);
  const history = usePoll(async () => {
    if (!epoch) return [];
    const ids = Array.from({ length: Math.min(12, epoch.id - 1) }, (_, i) => epoch.id - 1 - i);
    return (await Promise.all(ids.map((e) => o.epochSummary(e)))).filter(Boolean) as EpochSummary[];
  }, [epoch?.id], 10_000);

  if (!s) return <p className="label">Loading…</p>;
  const pool = big(s.pool);
  const liability = big(s.liability);
  const reserve = big(s.reserve);
  const used = pct(liability, pool);
  // this epoch: what traders lost to the house less what it paid winners
  const houseNet = epoch ? big(epoch.losses) - big(epoch.payouts) : 0n;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <PageTitle>The house</PageTitle>
        <p className="label mt-1.5">Why it can&apos;t go bust, live from the chain, and why it&apos;s fair to late players, from the simulator.</p>
      </div>
      <div className="panel p-5">
        <p className="text-lg">
          If every open position hit its max win at once, the house would pay{" "}
          <span className="num font-bold">${fmtUsdc(liability, 0)}</span>:{" "}
          <span className="num font-bold">{used.toFixed(1)}%</span> of the pool.
        </p>
        <p className="label mt-1">
          Every trade that would push this past 100% is refused, so there is never a payout queue. Both sides of each market
          are counted, because positions close at different times.
        </p>
        {epoch && (
          <p className="mt-3 text-sm">
            This round so far, traders lost <b className="num">{fmtUsd(big(epoch.losses))}</b> to the house and it paid winners{" "}
            <b className="num">{fmtUsd(big(epoch.payouts))}</b>: the house is{" "}
            <b className="num" style={{ color: houseNet >= 0n ? "var(--long)" : "var(--short)" }}>
              {houseNet >= 0n ? "up" : "down"} {fmtUsd(houseNet < 0n ? -houseNet : houseNet)}
            </b>
            .
          </p>
        )}
        {pool < big(s.seed) && (
          <p className="mt-3 flex items-center gap-2 text-sm">
            <Icon name="info" />
            <span>
              No payouts until the pool is back above its <b className="num">${fmtUsdc(big(s.seed), 0)}</b> seed. It&apos;s{" "}
              <b className="num">${fmtUsdc(big(s.seed) - pool, 0)}</b> short, so this round&apos;s Extra Lives and buyback wait for profit.
            </span>
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Tile label="Pool" value={pool} />
          <Tile label="Worst-case payout" value={liability} />
          <Tile label="Reserve (1.2× worst case, min the seed)" value={reserve} />
          <Tile label="Surplus above reserve" value={big(s.surplus)} />
        </div>

        <svg viewBox="0 0 1000 44" preserveAspectRatio="none" className="mt-5 h-11 w-full" role="img" aria-label={`Worst case is ${used.toFixed(1)}% of the pool`}>
          <rect x="0" y="12" width="1000" height="20" rx="4" fill="var(--panel-2)" stroke="var(--line)">
            <title>Pool ${fmtUsdc(pool, 0)}</title>
          </rect>
          <rect x="0" y="12" width={Math.max(4, Math.min(1000, used * 10))} height="20" rx="4" fill="var(--series-long)">
            <title>Worst-case payout ${fmtUsdc(liability, 0)} ({used.toFixed(1)}%)</title>
          </rect>
          <line x1={Math.min(1000, pct(reserve, pool) * 10)} x2={Math.min(1000, pct(reserve, pool) * 10)} y1="4" y2="40" stroke="var(--text)" strokeWidth="2" vectorEffect="non-scaling-stroke">
            <title>Reserve ${fmtUsdc(reserve, 0)}</title>
          </line>
        </svg>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <Legend color="var(--series-long)" label="Worst-case payout" />
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-0.5 bg-[var(--text)]" /> Reserve
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border border-[var(--line)] bg-[var(--panel-2)]" /> Pool
          </span>
        </div>

        <div className="-mx-5 mt-5 flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--line)] px-5 pt-5">
          <h2 className="text-lg font-extrabold">Per market: max wins against its cap (half the pool)</h2>
          <div className="flex gap-4 text-sm">
            <Legend color="var(--series-long)" label="Longs" />
            <Legend color="var(--series-short)" label="Shorts" />
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-0.5 bg-[var(--text)]" /> Capacity
            </span>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-4">
          {s.markets.map((m) => {
            const scale = big(m.capacity) > big(m.liability) ? big(m.capacity) : big(m.liability) || 1n;
            const w = (x: bigint) => pct(x, scale) * 10;
            const lw = w(big(m.long_liability));
            const sw = w(big(m.short_liability));
            return (
              <div key={m.id}>
                <div className="flex flex-col text-sm sm:flex-row sm:justify-between">
                  <span className="font-semibold sm:font-normal">{m.id}</span>
                  <span className="num label">
                    longs ${fmtUsdc(big(m.long_liability), 0)} · shorts ${fmtUsdc(big(m.short_liability), 0)} · capacity $
                    {fmtUsdc(big(m.capacity), 0)}
                  </span>
                </div>
                <svg viewBox="0 0 1000 24" preserveAspectRatio="none" className="mt-1 h-6 w-full" role="img" aria-label={`${m.id} liability against capacity`}>
                  <rect x="0" y="4" width="1000" height="16" rx="4" fill="var(--panel-2)" />
                  {lw > 0 && (
                    <rect x="0" y="4" width={Math.max(4, lw)} height="16" rx="4" fill="var(--series-long)">
                      <title>Longs ${fmtUsdc(big(m.long_liability), 0)}</title>
                    </rect>
                  )}
                  {sw > 0 && (
                    <rect x={lw + (lw > 0 ? 2 : 0)} y="4" width={Math.max(4, sw)} height="16" rx="4" fill="var(--series-short)">
                      <title>Shorts ${fmtUsdc(big(m.short_liability), 0)}</title>
                    </rect>
                  )}
                  <line x1={w(big(m.capacity))} x2={w(big(m.capacity))} y1="0" y2="24" stroke="var(--text)" strokeWidth="2" vectorEffect="non-scaling-stroke">
                    <title>Capacity ${fmtUsdc(big(m.capacity), 0)}</title>
                  </line>
                </svg>
              </div>
            );
          })}
        </div>

        <div className="-mx-5 mt-5 overflow-x-auto border-t border-[var(--line)] px-5 pt-5">
          <h2 className="text-lg font-extrabold">Rounds</h2>
          {(history ?? []).length === 0 ? (
            <p className="label mt-2">No closed rounds yet.</p>
          ) : (
            // phones: the round, what traders lost, the house's result, what lives got and the pool; the rest from 640px
            <table className="num mt-3 w-full text-sm">
              <thead>
                <tr className="label text-left">
                  <th className="pb-2 font-normal">Round</th>
                  <th className="pb-2 text-right font-normal">Traders lost</th>
                  <th className="hidden pb-2 text-right font-normal sm:table-cell">Winners took</th>
                  <th className="hidden pb-2 text-right font-normal md:table-cell">Market fees</th>
                  <th className="pb-2 text-right font-normal">House net</th>
                  <th className="hidden pb-2 text-right font-normal md:table-cell">Extra Lives</th>
                  <th className="hidden pb-2 text-right font-normal lg:table-cell">Life cap</th>
                  <th className="pb-2 text-right font-normal">Paid to lives</th>
                  <th className="hidden pb-2 text-right font-normal sm:table-cell">Buyback</th>
                  <th className="hidden pb-2 text-right font-normal sm:table-cell">Pool after</th>
                </tr>
              </thead>
              <tbody>
                {history!.map((e) => (
                  <tr key={e.epoch} className="border-t border-[var(--line)]">
                    <td className="py-2">{e.epoch}</td>
                    <td className="text-right">{fmtUsd(big(e.losses))}</td>
                    <td className="hidden text-right sm:table-cell">{fmtUsd(big(e.payouts))}</td>
                    <td className="hidden text-right md:table-cell">{fmtUsd(big(e.fees))}</td>
                    <td className="text-right">{fmtUsd(big(e.house_net))}</td>
                    <td className="hidden text-right md:table-cell">{e.lives_minted}</td>
                    <td className="hidden text-right lg:table-cell">{ppmToNumber(big(e.cap_ppm)).toFixed(2)}×</td>
                    <td className="text-right">{fmtUsd(big(e.lives_pot))}</td>
                    <td className="hidden text-right sm:table-cell">{fmtUsd(big(e.buyback_pot))}</td>
                    <td className="hidden text-right sm:table-cell">{fmtUsd(big(e.pool))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <MoneyAtWork pool={pool} liability={liability} />

      <div className="panel p-5 text-sm">
        <b>Where the pool comes from:</b> the house&apos;s seed and the bootstrap round. Backing has its own tab: the round, the
        curve, when it pays back, and the $1UP backers get.
      </div>
      <Fairness />
      <Governance />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: bigint }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="num text-2xl font-bold">${fmtUsdc(value, 0)}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

/** D-27: the pool USDC on hand and in the vault, and what the vault has earned for the jackpot. */
function MoneyAtWork({ pool, liability }: { pool: bigint; liability: bigint }) {
  const { o } = useOneUp();
  const t = usePoll(() => o.treasury(), [], 5000);
  const dep = usePoll(() => o.vaultDeposit(), [], 10_000);
  if (!t || !t.vault) return null;
  const deployed = big(t.deployed);
  const onHand = pool > deployed ? pool - deployed : 0n;
  const keep = (liability * 12n) / 10n;
  return (
    <div className="panel p-5">
      <h2 className="text-lg font-extrabold">The pool at work</h2>
      <p className="label mt-1 max-w-3xl">
        Pool USDC the house doesn&apos;t need on hand earns interest in a vault (5% here; USDC lending on Ethereum through NEAR Intents on
        mainnet). It always keeps 1.2× the worst-case payout plus 10% of the pool on hand, and brings money home before a round&apos;s
        payout. All the interest goes to the jackpot.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="On hand" value={onHand} />
        <Tile label="Earning in the vault" value={deployed} />
        <Tile label="Kept for the worst case (1.2×)" value={keep} />
        <Tile label="Interest waiting for the jackpot" value={dep ? big(dep.interest) : 0n} />
      </div>
      <svg viewBox="0 0 1000 24" preserveAspectRatio="none" className="mt-4 h-6 w-full" role="img" aria-label={`${pct(deployed, pool).toFixed(0)}% of the pool is earning`}>
        <rect x="0" y="2" width="1000" height="20" rx="4" fill="var(--panel-2)" stroke="var(--line)" />
        <rect x="0" y="2" width={Math.min(1000, pct(deployed, pool) * 10)} height="20" rx="4" fill="var(--accent)" />
      </svg>
      <p className="label num mt-1">{pct(deployed, pool).toFixed(0)}% of the pool is earning</p>
    </div>
  );
}
