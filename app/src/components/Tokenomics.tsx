"use client";

// $1UP: who gets it, how it's released, where its value comes from, and what's happened so far (D-15, D-16, D-26).

import { EMISSIONS_TOTAL, EMISSION_EPOCHS, ONEUP, ONEUP_PER_USDC, SUPPLY, fmtUsdc } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { useOneupPrice } from "@/lib/value";
import { fmtOneup } from "./Header";
import { PixelHeart, PixelLock } from "./Pixel";
import { Icon } from "./Icon";

const M = 1_000_000n * ONEUP;

/** The fixed supply, minted once (contracts/oneup-token). Backers' 7.5M comes out of the treasury (D-26). */
const SPLIT = [
  { name: "Losers, by house profit", amount: 900n * M, color: "var(--heart)", note: "Released over 208 rounds as house profit allows, only to losing wallets, always locked for two years" },
  { name: "Liquidity seed", amount: 50n * M, color: "var(--info)", note: "Pairs with USDC for the buyback pool (Rhea on mainnet)" },
  { name: "Treasury", amount: 42_500_000n * ONEUP, color: "var(--muted)", note: "Run by the DAO that owns the house" },
  { name: "Backers", amount: 7_500_000n * ONEUP, color: "var(--accent)", note: "10 per $1 backed in the bootstrap round, locked for two years" },
];

export function Tokenomics() {
  const { o } = useOneUp();
  const px = useOneupPrice();
  const epoch = usePoll(() => o.epoch(), [], 10_000);
  const carry = usePoll(() => o.emissionCarry(), [], 10_000);
  const round = usePoll(() => o.backing(), [], 10_000);
  // every round's emissions so far (a few hundred at most)
  const history = usePoll(
    async () => {
      if (!epoch) return [];
      const ids = Array.from({ length: Math.min(208, epoch.id - 1) }, (_, i) => i + 1);
      return (await Promise.all(ids.map((e) => o.emissions(e)))).filter((x) => x !== null);
    },
    [epoch?.id],
    30_000,
  );
  const released = (history ?? []).reduce((s, x) => s + BigInt(x!.released), 0n);
  const buybacks = usePoll(
    async () => {
      if (!epoch) return 0n;
      const ids = Array.from({ length: Math.min(208, epoch.id - 1) }, (_, i) => i + 1);
      const bs = await Promise.all(ids.map((e) => o.buyback(e)));
      return bs.reduce((s, b) => s + (b ? BigInt(b.usdc) : 0n), 0n);
    },
    [epoch?.id],
    30_000,
  );
  const backersUsed = round ? 7_500_000n * ONEUP - BigInt(round.oneup_left) : 0n;
  const perRound = EMISSIONS_TOTAL / EMISSION_EPOCHS;
  const last = (history ?? []).slice(-24);
  const top = last.reduce((m, x) => (BigInt(x!.scheduled) > m ? BigInt(x!.scheduled) : m), perRound);

  return (
    <div className="flex flex-col gap-5">
      <section className="case relative overflow-hidden p-5 sm:p-8">
        <p className="label">Tokenomics</p>
        <h1 className="display mt-2 text-3xl leading-tight sm:text-4xl">$1UP: earned by losing</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          A fixed billion, minted once. Nine in ten go to the people who lose trades, released only as fast as the house actually
          makes money, and always locked for two years. Locks earn the house&apos;s buybacks. No team or investor allocation.
        </p>
        <dl className="num mt-5 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Price" value={px > 0n ? `$${(Number(px) / 1e6).toFixed(4)}` : "…"} />
          <Stat label="Supply" value="1,000,000,000" />
          <Stat label="Released to losers" value={history ? fmtOneup(released.toString()) : "…"} />
          <Stat label="Bought back" value={buybacks === undefined ? "…" : `$${fmtUsdc(buybacks, 0)}`} />
        </dl>
      </section>

      <section className="panel p-5">
        <h2 className="text-lg font-extrabold">Where the billion goes</h2>
        <div className="mt-4 flex h-5 overflow-hidden rounded-full border border-[var(--line)]" role="img" aria-label="90% losers, 5% liquidity, 4.25% treasury, 0.75% backers">
          {SPLIT.map((s) => (
            <span key={s.name} style={{ width: `${(Number(s.amount) / Number(SUPPLY)) * 100}%`, background: s.color }} title={s.name} />
          ))}
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {SPLIT.map((s) => (
            <li key={s.name} className="flex gap-3 text-sm">
              <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span>
                <b>{s.name}</b> <span className="num label">{fmtOneup(s.amount.toString())} · {((Number(s.amount) / Number(SUPPLY)) * 100).toFixed(2).replace(/\.?0+$/, "")}%</span>
                <span className="block text-[var(--muted)]">{s.note}</span>
              </span>
            </li>
          ))}
        </ul>
        {round && (
          <p className="label num mt-3">
            Backers have had {fmtOneup(backersUsed.toString())} of their {fmtOneup((7_500_000n * ONEUP).toString())} so far.
          </p>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card icon={<PixelHeart size={24} />} title="Released by profit">
          Each round can release up to {fmtOneup(perRound.toString())} $1UP (900M over 208 rounds), but only {ONEUP_PER_USDC.toString()} per $1 the
          house actually made. What isn&apos;t released carries to later rounds{carry ? `: ${fmtOneup(carry)} now` : ""}.
        </Card>
        <Card icon={<PixelLock size={22} />} title="Only to losers, locked">
          A round&apos;s $1UP is shared by its losers in proportion to their net loss, as two-year locks. Winners are paid in USDC
          instead. Farming it with a long and a short on yourself costs the winner&apos;s cut and pays only at very high prices.
        </Card>
        <Card icon={<Icon name="claim" size={22} />} title="Value from buybacks">
          30% of every round&apos;s payout buys $1UP on the market and shares it across locks by weight (amount × time left). Leaving a lock
          early costs up to half, paid to those who stay.
        </Card>
      </div>

      <section className="panel p-5">
        <h2 className="text-lg font-extrabold">If OneUp winds down</h2>
        <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm">
          <li>Traders take back their own money: positions close at the oracle price and balances can be withdrawn.</li>
          <li>Extra Lives and Backer Lives are paid from the whole pool, by what each is still owed. They&apos;re the house&apos;s debts.</li>
          <li>
            Whatever&apos;s left goes to $1UP lockers by lock weight. Lockers are the owners: last in line, but everything left is theirs.
          </li>
        </ol>
        <p className="label mt-2">Only the DAO can start it. A plan for now (D-29); the shutdown mode isn&apos;t in the contracts yet.</p>
      </section>

      <section className="panel p-5">
        <h2 className="text-lg font-extrabold">Released, round by round</h2>
        <p className="label mt-1">Each bar is a round&apos;s schedule; the filled part is what house profit released to its losers.</p>
        {last.length === 0 ? (
          <p className="label mt-3">No rounds have closed yet.</p>
        ) : (
          <div className="mt-4 flex h-32 items-end gap-1" role="img" aria-label="$1UP released per round against the schedule">
            {last.map((x) => {
              const sched = BigInt(x!.scheduled) + 0n;
              const rel = BigInt(x!.released);
              return (
                <div key={x!.epoch} className="relative flex h-full flex-1 items-end" title={`Round ${x!.epoch}: ${fmtOneup(x!.released)} of ${fmtOneup(x!.scheduled)} released`}>
                  <div className="absolute bottom-0 w-full rounded-t-[3px] bg-[var(--panel-2)]" style={{ height: `${(Number(sched) / Number(top)) * 100}%` }} />
                  <div className="absolute bottom-0 w-full rounded-t-[3px] bg-[var(--heart)]" style={{ height: `${Math.min(100, (Number(rel) / Number(top)) * 100)}%` }} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="text-xl font-extrabold">{value}</dd>
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
