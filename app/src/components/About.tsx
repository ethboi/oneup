"use client";

// About: what OneUp is, how it works, what's built on NEAR and what's mocked, for judges and first-time
// visitors. The app's entry for NEAR HACKATHON.

import { PixelCoin, PixelHeart } from "./Pixel";
import { Icon, type IconName } from "./Icon";

const STEPS: { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: <Icon name="chart" size={22} />,
    title: "Trade against the house",
    body: "Long or short up to 100× at the oracle price, against one USDC pool. No fees, no funding, no slippage. Every trade the pool couldn't pay in the worst case is refused, so the house can't go bust.",
  },
  {
    icon: <PixelHeart size={22} />,
    title: "Lose, get an Extra Life",
    body: "When an epoch ends with the house in profit, its losers get Extra Lives: NFTs that earn USDC back from the house's later profit, up to a cap, for 13 epochs.",
  },
  {
    icon: <PixelCoin size={22} />,
    title: "Plus $1UP, locked",
    body: "Losers also get $1UP, released only by real house profit, locked for two years. Locks earn the house's buybacks, weighted by size and time left.",
  },
  {
    icon: <Icon name="store" size={22} />,
    title: "Sell any time",
    body: "Extra Lives and locks are NFTs. List them on the built-in market for USDC instead of waiting them out.",
  },
];

const BUILT: { icon: IconName; title: string; body: string }[] = [
  { icon: "shield", title: "8 Rust contracts", body: "House, Extra Life (NEP-171), $1UP (NEP-141), locks, market (NEP-178 approvals), and mock USDC, oracle and swap. Events follow NEP-297." },
  { icon: "check", title: "100 contract tests", body: "Unit and property tests, plus end-to-end tests on a sandbox chain." },
  { icon: "demo", title: "Keeper and bots", body: "Anyone can run the keeper: it pushes prices, fills orders, liquidates, fires take-profits and stop-losses, and closes epochs. Six bots trade, lock and shop." },
  { icon: "scale", title: "Simulations", body: "Fairness to late players and the cost of farming $1UP, tested before the rules were fixed." },
];

export function About() {
  return (
    <div className="flex flex-col gap-4">
      <section className="case relative overflow-hidden p-5 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="label">Our entry for NEAR HACKATHON, November 2026</p>
            <h1 className="display mt-2 text-4xl leading-tight sm:text-5xl">Lose a trade, get a life.</h1>
            <p className="mt-3 max-w-xl text-[var(--muted)]">
              OneUp is a perpetuals exchange on NEAR where losing isn&apos;t the end of the story. Trade against a house
              that can&apos;t go bust; if you lose, you get an Extra Life that pays you back from the house&apos;s profit.
            </p>
          </div>
          <div className="bezel shrink-0 self-start p-4 sm:self-auto">
            <div className="lcd flex h-36 w-52 flex-col items-center justify-center gap-2">
              <PixelHeart size={64} />
              <span className="display text-lg text-[var(--lcd-ink)]">+1 EXTRA LIFE</span>
            </div>
          </div>
        </div>
      </section>

      <div className="panel divide-y divide-[var(--line)]">
        <section className="p-5">
          <h2 className="text-lg font-extrabold">How it works</h2>
          <ol className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-2">
                <span className="flex items-center gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--panel-2)] text-[var(--primary)]">{s.icon}</span>
                  <span className="label num">Step {i + 1}</span>
                </span>
                <b>{s.title}</b>
                <span className="text-sm text-[var(--muted)]">{s.body}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="p-5">
          <h2 className="text-lg font-extrabold">Why it&apos;s different</h2>
          <ul className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <li>
              <b className="block">Losses come back</b>
              <span className="text-[var(--muted)]">On most exchanges a loss is gone. Here the house shares its profit with the people it came from.</span>
            </li>
            <li>
              <b className="block">Fair to late players</b>
              <span className="text-[var(--muted)]">Lives expire, so early claims can&apos;t crowd out new ones. A dollar lost in year three gets back about what one lost early does.</span>
            </li>
            <li>
              <b className="block">Hard to farm</b>
              <span className="text-[var(--muted)]">$1UP is released only by real house profit and arrives locked for two years, which makes wash-trading for it expensive.</span>
            </li>
          </ul>
        </section>

        <section className="p-5">
          <h2 className="text-lg font-extrabold">What&apos;s built</h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2">
            {BUILT.map((b) => (
              <li key={b.title} className="flex gap-3 text-sm">
                <Icon name={b.icon} size={20} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                <span>
                  <b className="block">{b.title}</b>
                  <span className="text-[var(--muted)]">{b.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="p-5">
          <h2 className="text-lg font-extrabold">Built on NEAR</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-[var(--muted)]">
            <li>
              <b className="text-[var(--text)]">Standards all the way down.</b> USDC and $1UP are NEP-141 tokens; Extra Lives and
              locks are NEP-171 NFTs, listed with NEP-178 approvals; every contract emits NEP-297 events, which the app
              reads for its feed and your history.
            </li>
            <li>
              <b className="text-[var(--text)]">Access keys for the keeper.</b> Prices go out on a function-call key that can only call
              the oracle&apos;s <code>push_prices</code>, so a price feed never holds a full-access key.
            </li>
            <li>
              <b className="text-[var(--text)]">One step to trade.</b> A deposit and an order travel together in one{" "}
              <code>ft_transfer_call</code>; if the order is refused, the whole deposit comes back.
            </li>
          </ul>
        </section>

        <section className="p-5">
          <h2 className="text-lg font-extrabold">This demo</h2>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            Everything runs on a local NEAR chain started with one command. Prices are real (Binance, with Coinbase as a
            fallback), pushed to a Pyth-compatible oracle; USDC and the buyback swap are local stand-ins. On mainnet the
            house reads Outlayer&apos;s Pyth oracle and buys back on Rhea, with the same calls. Epochs are 10 minutes so you
            can watch Extra Lives arrive.
          </p>
        </section>
      </div>
    </div>
  );
}
