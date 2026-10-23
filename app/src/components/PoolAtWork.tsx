"use client";

// D-27, the pool at work: what the house keeps on hand, what it sends out to earn, where it earns (the mock
// vault here; lending on Ethereum through NEAR Intents from its Chain Signatures address on mainnet), and the
// jackpot all of the interest goes to.

import type { ReactNode } from "react";
import { fmtUsdc } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { useNow } from "./Header";
import { PixelAmount, PixelCoin, PixelMark } from "./Pixel";

const big = (x?: string) => (x === undefined ? 0n : BigInt(x));
const pct = (a: bigint, b: bigint) => (b === 0n ? 0 : Number((a * 10_000n) / b) / 100);
/** USDC (6 decimals) as dollars, for display maths only. */
const usd = (x: bigint) => Number(x) / 1e6;
const money = (n: number, dp = 0) => `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

// the mock vault's year is 52 demo rounds (scripts/deploy.ts); on mainnet a round is a week, so 52 a year too
const ROUNDS_A_YEAR = 52;

const TAG = {
  live: { label: "Live here", bg: "color-mix(in srgb, var(--long) 15%, transparent)", fg: "var(--long)" },
  simulated: { label: "Simulated locally", bg: "color-mix(in srgb, var(--info) 15%, transparent)", fg: "var(--info)" },
  mainnet: { label: "Mainnet plan", bg: "var(--panel)", fg: "var(--muted)" },
};

function Tag({ kind }: { kind: keyof typeof TAG }) {
  const t = TAG[kind];
  return (
    <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold whitespace-nowrap" style={{ background: t.bg, color: t.fg }}>
      {t.label}
    </span>
  );
}

/** One step of the flow: a box with a small heading. */
function Step({ n, title, children, accent }: { n: number; title: string; children: ReactNode; accent?: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3.5" style={accent ? { borderColor: accent } : undefined}>
      <div className="label flex items-center gap-2 text-xs font-bold tracking-wide uppercase">
        <span className="num grid h-5 w-5 place-items-center rounded-full bg-[var(--panel)] text-[11px]" style={accent ? { color: accent } : undefined}>
          {n}
        </span>
        {title}
      </div>
      <div className="mt-2 flex flex-1 flex-col">{children}</div>
    </div>
  );
}

/** The arrow between steps: right on wide screens, down when they stack. */
function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-0.5 text-[var(--muted)] lg:flex-col lg:py-0" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-5 w-5 rotate-90 lg:rotate-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
        <path d="M3 12h16M13 6l6 6-6 6" />
      </svg>
      {label && <span className="text-[11px] font-bold lg:max-w-[64px] lg:text-center">{label}</span>}
    </div>
  );
}

export function PoolAtWork({ pool, liability }: { pool: bigint; liability: bigint }) {
  const { o, d } = useOneUp();
  const now = useNow();
  const t = usePoll(() => o.treasury(), [], 5000);
  const dep = usePoll(() => o.vaultDeposit(), [], 10_000);
  const apr = usePoll(async () => (t?.vault ? Number(big((await o.view<string>(t.vault, "apr_ppm")) ?? "0")) / 1e6 : null), [t?.vault], 60_000);
  if (!t || !t.vault) return null;

  const deployed = big(t.deployed);
  const onHand = pool > deployed ? pool - deployed : 0n;
  const keep = (liability * 12n) / 10n; // 1.2× the worst-case payout
  const float = pool / 10n; // plus 10% of the pool
  const mustStay = keep + float > pool ? pool : keep + float;
  const jackpot = big(t.jackpot);
  const rate = apr ?? 0.05;

  // the vault's interest, ticking between polls at its own rate (its year is 52 rounds here)
  const yearS = ROUNDS_A_YEAR * d.epochLengthS;
  const since = dep ? Math.max(0, now - dep.updated) : 0;
  const accrued = dep ? usd(big(dep.interest)) + (usd(big(dep.principal)) * rate * since) / yearS : 0;
  const perRound = (usd(deployed) * rate) / ROUNDS_A_YEAR;
  const perYear = usd(deployed) * rate;
  const earningPct = pct(deployed, pool);

  return (
    <div className="panel p-5" id="pool-at-work">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-lg font-extrabold">The pool at work</h2>
        <span className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-2 py-1 text-xs font-bold">
          <PixelMark name="intents" label="NEAR Intents" size={20} />
          Idle USDC earns via NEAR Intents
        </span>
      </div>

      {/* the headline: how much is out earning, at what rate, and what it has made */}
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xl leading-snug sm:text-2xl">
            <b className="num" style={{ color: "var(--long)" }}>
              ${fmtUsdc(deployed, 0)}
            </b>{" "}
            of the pool is out earning <b className="num">{(rate * 100).toFixed(rate * 100 < 10 ? 1 : 0).replace(/\.0$/, "")}%</b> a year.
          </p>
          <p className="label mt-1 max-w-2xl">
            That&apos;s <b className="num text-[var(--text)]">{earningPct.toFixed(0)}%</b> of the pool, making about{" "}
            <b className="num text-[var(--text)]">{money(perRound, perRound < 100 ? 2 : 0)}</b> a round ({money(perYear)} a year). Every cent
            of it goes to the jackpot.
          </p>
        </div>
        <div className="shrink-0">
          <div className="label mb-1 text-xs">Interest so far, on its way to the jackpot</div>
          <div className="bezel inline-block rounded-xl px-2.5 py-2">
            <div className="lcd rounded-lg px-3 py-2" aria-label={`Interest earned ${money(accrued, 4)}`}>
              <PixelAmount text={money(accrued, 4)} height={28} />
            </div>
          </div>
        </div>
      </div>

      {/* the flow: pool, split, where it earns, jackpot */}
      <div className="mt-5 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,0.8fr)_auto_minmax(0,1.1fr)_auto_minmax(0,1.5fr)_auto_minmax(0,0.9fr)] lg:items-stretch">
        <Step n={1} title="The pool">
          <div className="num text-2xl font-bold">${fmtUsdc(pool, 0)}</div>
          <p className="label mt-1 text-xs">The house&apos;s USDC, there to pay winners in the worst case.</p>
        </Step>
        <Arrow label="split" />
        <Step n={2} title="On hand · at work">
          <div className="flex flex-col gap-2.5">
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">Kept on hand</span>
                <span className="num font-bold">${fmtUsdc(onHand, 0)}</span>
              </div>
              <p className="label text-xs">
                At least 1.2× worst case (${fmtUsdc(keep, 0)}) + 10% float (${fmtUsdc(float, 0)})
              </p>
            </div>
            <div className="border-t border-[var(--line)] pt-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold" style={{ color: "var(--long)" }}>
                  Sent to work
                </span>
                <span className="num font-bold" style={{ color: "var(--long)" }}>
                  ${fmtUsdc(deployed, 0)}
                </span>
              </div>
              <p className="label text-xs">Everything above that, up to ${fmtUsdc(big(t.deployable), 0)} now</p>
            </div>
          </div>
        </Step>
        <Arrow label="lend" />
        <Step n={3} title="Earning" accent="var(--long)">
          <div className="flex flex-col gap-2.5">
            <div>
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="flex shrink-0 gap-1">
                    <PixelMark name="intents" label="NEAR Intents" size={22} />
                    <PixelMark name="near" label="NEAR Chain Signatures" size={22} />
                  </span>
                  <span className="text-sm font-semibold">USDC lending on Ethereum</span>
                </span>
                <Tag kind="mainnet" />
              </div>
              <p className="label mt-1 text-xs">
                Reached through NEAR Intents and held by the house&apos;s own Chain Signatures Ethereum address. No person holds the keys;
                the DAO picks the market (Aave v3 or a conservative Morpho vault, about 4.5–5%).
              </p>
            </div>
            <div className="border-t border-[var(--line)] pt-2.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold">Mock vault, {(rate * 100).toFixed(0)}% a year</span>
                <Tag kind="simulated" />
              </div>
              <p className="label mt-1 text-xs">Stands in on this local chain. Its year is 52 rounds, so the interest shows.</p>
            </div>
          </div>
        </Step>
        <Arrow label="interest" />
        <Step n={4} title="Jackpot" accent="var(--jackpot)">
          <div className="flex items-center gap-2">
            <PixelCoin size={22} />
            <span className="num text-2xl font-bold" style={{ color: "var(--jackpot)" }}>
              ${fmtUsdc(jackpot, jackpot < 1_000_000_000n ? 2 : 0)}
            </span>
          </div>
          <p className="label mt-1 text-xs">All of the interest. Drawn when round {t.draw_epoch} closes; each $1 lost is a ticket.</p>
        </Step>
      </div>

      {/* on hand against earning, with the line the house can't go below */}
      <div className="mt-5">
        <div className="mb-1.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border border-[var(--line)] bg-[var(--panel-2)]" /> On hand{" "}
            <b className="num">${fmtUsdc(onHand, 0)}</b>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--long)" }} /> Earning{" "}
            <b className="num">${fmtUsdc(deployed, 0)}</b>
            <span className="label num">({earningPct.toFixed(0)}%)</span>
          </span>
        </div>
        <svg viewBox="0 0 1000 32" preserveAspectRatio="none" className="h-8 w-full" role="img" aria-label={`${earningPct.toFixed(0)}% of the pool is earning`}>
          <rect x="0" y="6" width="1000" height="20" rx="4" fill="var(--panel-2)" stroke="var(--line)" vectorEffect="non-scaling-stroke">
            <title>On hand ${fmtUsdc(onHand, 0)}</title>
          </rect>
          {deployed > 0n && (
            <rect x={1000 - Math.min(1000, earningPct * 10)} y="6" width={Math.min(1000, earningPct * 10)} height="20" rx="4" fill="var(--long)">
              <title>Earning ${fmtUsdc(deployed, 0)}</title>
            </rect>
          )}
          <line x1={pct(mustStay, pool) * 10} x2={pct(mustStay, pool) * 10} y1="0" y2="32" stroke="var(--text)" strokeWidth="2" vectorEffect="non-scaling-stroke">
            <title>Must stay on hand ${fmtUsdc(mustStay, 0)}</title>
          </line>
        </svg>
        <p className="label mt-1.5 flex items-start gap-1.5 text-xs">
          <span className="mt-0.5 inline-block h-3 w-0.5 shrink-0 bg-[var(--text)]" />
          <span>
            Must stay on hand: <b className="num text-[var(--text)]">${fmtUsdc(mustStay, 0)}</b>. Before a round distributes profit, the house attempts to recall
            the required USDC from the vault. Failed recalls can delay settlement; vault and custody risks remain.
          </span>
        </p>
      </div>
    </div>
  );
}
