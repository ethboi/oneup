"use client";

// About: what OneUp is, how it works, what's built on NEAR and what's mocked, for judges and first-time
// visitors. The app's entry for NEAR HACKATHON.

import { PixelCoin, PixelHeart, PixelMark } from "./Pixel";
import type { MarkName } from "@/lib/marks";
import { Icon, type IconName } from "./Icon";

const STEPS: { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: <Icon name="chart" size={22} />,
    title: "Trade against the house",
    body: "Long or short up to 1000× at the oracle price, against one USDC pool. No entry or funding fee; winners pay 10–25% of profit. Admission reserves capped maximum wins on both sides. This invariant assumes correct custody, oracle and contract execution.",
  },
  {
    icon: <PixelHeart size={22} />,
    title: "Lose, get an Extra Life",
    body: "When a round ends with the house in profit, its losers get Extra Lives: NFTs that earn USDC back from the house's later profit, up to a cap, for 14 rounds.",
  },
  {
    icon: <PixelCoin size={22} />,
    title: "Plus $1UP, locked",
    body: "Losers also get $1UP, released only by real house profit, locked for 104 rounds. Locks earn the house's buybacks, weighted by size and time left.",
  },
  {
    icon: <Icon name="store" size={22} />,
    title: "Transfer claim rights",
    body: "Extra Lives and locks are NFTs. List them on the built-in market for USDC if a buyer is willing. Future payouts and sale proceeds are not guaranteed.",
  },
];

/** Where each half of the design comes from, and what OneUp changes in it. */
const LINEAGE: { from: string; idea: string; rows: { topic: string; them: string; oneup: string }[] }[] = [
  {
    from: "Papertrade",
    idea: "A loss buys a claim on the house",
    rows: [
      { topic: "What a loss gets you", them: "PAPER tokens, 100 per $1 lost, staked for a share of profit", oneup: "An Extra Life paying USDC back, capped, plus $1UP locked" },
      { topic: "When winners can't be paid", them: "Winners wait in a queue as debt", oneup: "Admission refuses trades beyond reserved capacity; custody/oracle/code risks remain" },
      { topic: "How long a claim lasts", them: "Forever, so early claims crowd out late ones", oneup: "Mint round plus 13 subsequent rounds; recovery depends on future profit" },
    ],
  },
  {
    from: "Aerodrome",
    idea: "A lock that earns by size and time left",
    rows: [
      { topic: "The lock", them: "AERO locked up to 4 years as a veAERO NFT", oneup: "$1UP locked up to 104 rounds as an NFT; weight is amount × time left" },
      { topic: "What it earns", them: "Fees and bribes from the pools you vote for", oneup: "The house's buybacks: no voting, no bribes" },
      { topic: "Getting out early", them: "Sell the NFT on another marketplace", oneup: "Leave for a penalty paid to those who stay, or sell on the built-in market" },
    ],
  },
];

const BUILT: { icon: IconName; title: string; body: string }[] = [
  { icon: "shield", title: "9 Rust contracts", body: "House, Extra Life (NEP-171), $1UP (NEP-141), locks, market (NEP-178 approvals), and mock USDC, oracle, swap and yield vault. Events follow NEP-297." },
  { icon: "check", title: "Failure-path regression tests", body: "Unit, property, SDK and fresh-sandbox integration tests. Run pnpm verify for current results; review findings and regression coverage are documented in docs/SECURITY.md." },
  { icon: "demo", title: "Keeper and bots", body: "Anyone can run the keeper: it pushes prices, fills orders, liquidates, fires take-profits and stop-losses, and closes rounds. Twelve bots with different styles trade, lock and shop, and an MCP server lets AI agents trade too." },
  { icon: "scale", title: "Simulations", body: "Aggregate recovery sensitivity and same/separate-wallet farming assumptions. These models do not prove demand, fairness or Sybil resistance." },
];

type Status = "demo" | "simulated" | "mainnet";

const STATUS: Record<Status, { label: string; bg: string; fg: string }> = {
  demo: { label: "In the demo", bg: "color-mix(in srgb, var(--long) 15%, transparent)", fg: "var(--long)" },
  simulated: { label: "Simulated locally", bg: "color-mix(in srgb, var(--info) 15%, transparent)", fg: "var(--info)" },
  mainnet: { label: "Mainnet plan", bg: "var(--panel-2)", fg: "var(--muted)" },
};

/** Every NEAR tool OneUp uses, for the Built on NEAR section. */
const NEAR: { title: string; status: Status; body: string; points: string[]; marks: { name: MarkName; label: string }[] }[] = [
  {
    title: "Rust smart contracts",
    marks: [{ name: "rust", label: "Rust" }],
    status: "demo",
    body: "Nine contracts written with near-sdk 5, built with cargo-near.",
    points: [
      "House, Extra Life, $1UP, ve locks and the market, plus mock USDC, oracle, swap and yield vault",
      "Contract accounts have their keys deleted after deploy, so nobody can redeploy them",
      "Cross-contract calls with callbacks for every payout, mint and recall",
    ],
  },
  {
    title: "NEAR standards",
    marks: [{ name: "near", label: "NEAR" }],
    status: "demo",
    body: "Everything that moves follows a NEP, so wallets, explorers and indexers understand it.",
    points: [
      "NEP-141 fungible tokens with NEP-145 storage: $1UP and USDC",
      "NEP-171 NFTs with NEP-177 metadata, NEP-178 approvals and NEP-181 enumeration: Extra Lives and locks",
      "NEP-297 events, which the app's feed, history and leaderboard read",
      "NEP-245 multi-token balances inside NEAR Intents",
    ],
  },
  {
    title: "NEAR Intents",
    marks: [{ name: "intents", label: "NEAR Intents" }],
    status: "simulated",
    body: "Pay from Ethereum or Solana in one signature: bridge, swap to USDC and deposit, as one intent.",
    points: [
      "The official Verifier and PoA token factory (release 0.4.2) run on the local chain",
      "Intents are signed with the official SDK; OneUp's solver fills them with execute_intents",
      "Local bridge credit is simulated; no real Ethereum/Solana deposit or 1Click integration is implemented",
    ],
  },
  {
    title: "Sputnik DAO",
    marks: [{ name: "dao", label: "Sputnik DAO" }],
    status: "demo",
    body: "A DAO owns the house: the same Sputnik DAO v2 code mainnet DAOs run.",
    points: [
      "Listing and pausing markets, params, the keeper, the yield vault: all council votes",
      "Proposals and votes are in the app, on the House tab",
    ],
  },
  {
    title: "Function-call keys (session keys)",
    marks: [{ name: "near", label: "NEAR" }],
    status: "demo",
    body: "One-tap trading signs with a key that can only call the house's trade methods.",
    points: ["It can open, close and set triggers; trading can still lose the balance. It cannot directly withdraw tokens", "Turn it off and the key is deleted"],
  },
  {
    title: "Meta transactions (NEP-366)",
    marks: [{ name: "near", label: "NEAR" }],
    status: "demo",
    body: "Gasless trades: the app signs a delegate action and a relayer pays the gas.",
    points: ["The relayer only forwards trade calls to the house, with a gas cap and a rate limit"],
  },
  {
    title: "Chain Signatures",
    marks: [{ name: "near", label: "NEAR" }],
    status: "mainnet",
    body: "How the house would hold its yield position on Ethereum from a NEAR contract (D-27).",
    points: [
      "The house's own derived Ethereum address lends idle pool USDC, reached through NEAR Intents",
      "No person holds the keys; the DAO picks where it lends",
      "Locally a 5% mock vault stands in",
    ],
  },
  {
    title: "Pyth prices via Outlayer",
    marks: [{ name: "pyth", label: "Pyth" }, { name: "outlayer", label: "Outlayer" }],
    status: "simulated",
    body: "Order fills require a later oracle price; liquidation uses the latest valid price. Prompt execution still trusts the keeper.",
    points: [
      "Locally the keeper pushes live Binance prices into a Pyth-compatible oracle",
      "An Outlayer-compatible interface exists; real-network deployment and feed behavior remain unverified",
      "The house checks each price's age, confidence and that it isn't from the future",
    ],
  },
  {
    title: "Rhea",
    marks: [{ name: "rhea", label: "Rhea" }],
    status: "mainnet",
    body: "Intended buyback venue; the working demo uses a custom mock swap. No real Rhea adapter is implemented.",
    points: ["Local custom swap payload; a real Rhea adapter remains to be implemented", "Its 50M $1UP liquidity seed is minted at launch"],
  },
  {
    title: "NEAR randomness",
    marks: [{ name: "near", label: "NEAR" }],
    status: "demo",
    body: "The jackpot is drawn from the block's random seed at a round's close.",
    points: ["Pyth Entropy only runs on EVM chains, so NEAR's own randomness is used (D-27)"],
  },
  {
    title: "Local chain and tests",
    marks: [{ name: "near", label: "NEAR" }],
    status: "demo",
    body: "One command runs a real NEAR node and deploys everything; the same tooling runs the tests.",
    points: [
      "near-sandbox for the local chain (pnpm demo)",
      "near-workspaces for end-to-end tests on a sandbox chain",
      "near-api-js 7 in the app, keeper, bots and the MCP server",
    ],
  },
  {
    title: "AI agents (MCP)",
    marks: [{ name: "near", label: "NEAR" }],
    status: "demo",
    body: "An MCP server lets an AI agent trade on OneUp: read markets, quote, open and close, set triggers, claim lives.",
    points: ["Registered in .mcp.json; uses the demo/bot full key, not a capital-limited agent wallet"],
  },
];

export function About() {
  return (
    <div className="flex flex-col gap-4">
      <section className="case relative overflow-hidden p-5 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="label">
              Our entry for NEAR HACKATHON, November 2026, by{" "}
              <a className="font-bold text-[var(--text)] underline decoration-dotted underline-offset-2" href="https://x.com/ethboi_" target="_blank" rel="noreferrer">
                ethboi
              </a>
            </p>
            <h1 className="display mt-2 text-4xl leading-tight sm:text-5xl">Lose a trade, get a life.</h1>
            <p className="mt-3 max-w-xl text-[var(--muted)]">
              OneUp is a perpetuals exchange on NEAR where losing isn&apos;t the end of the story. Trade against a house
              with reserved capped payouts. Eligible net losses can create a tradable Extra Life sharing future house profit; recovery can be zero.
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
          <h2 className="text-lg font-extrabold">Papertrade meets Aerodrome</h2>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            The idea that a loss buys you a claim on the house comes from Papertrade. The lock that earns protocol
            revenue, weighted by how long it has left, comes from Aerodrome&apos;s vote-escrow. OneUp keeps both and
            changes what made each one hard to live with.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {LINEAGE.map((l) => (
              <div key={l.from} className="rounded-xl border border-[var(--line)] p-4">
                <p className="label">From {l.from}</p>
                <h3 className="font-extrabold">{l.idea}</h3>
                <ul className="mt-3 flex flex-col divide-y divide-[var(--line)]">
                  {l.rows.map((r) => (
                    <li key={r.topic} className="py-2.5 text-sm">
                      <b className="block">{r.topic}</b>
                      <span className="mt-1 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1">
                        <span className="label">{l.from}</span>
                        <span className="text-[var(--muted)]">{r.them}</span>
                        <span className="label font-bold text-[var(--primary)]">OneUp</span>
                        <span>{r.oneup}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="p-5">
          <h2 className="text-lg font-extrabold">Why it&apos;s different</h2>
          <ul className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <li>
              <b className="block">Conditional loss recovery</b>
              <span className="text-[var(--muted)]">On most exchanges a loss is gone. Here the house shares its profit with the people it came from.</span>
            </li>
            <li>
              <b className="block">Expiring recovery claims</b>
              <span className="text-[var(--muted)]">Expiry bounds future claim lifetimes; recovery still depends on future profits and can be zero. Economic scenarios show both favorable and unfavorable results.</span>
            </li>
            <li>
              <b className="block">Farming assumptions</b>
              <span className="text-[var(--muted)]">$1UP releases with house profit and arrives locked for 104 rounds. Separate-wallet strategies and sale discounts change farming economics; wallet netting is not Sybil resistance.</span>
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

        <section id="built" className="scroll-mt-4 p-5">
          <h2 className="text-lg font-extrabold">Built on NEAR</h2>
          <p className="label mt-1 max-w-3xl">Every NEAR tool and standard OneUp uses, and whether it runs in this demo, is simulated here, or is the mainnet plan.</p>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {NEAR.map((n) => (
              <li key={n.title} className="rounded-xl border border-[var(--line)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex items-center gap-3">
                    <span className="flex shrink-0 gap-1.5">
                      {n.marks.map((m) => (
                        <PixelMark key={m.name} name={m.name} label={m.label} size={34} />
                      ))}
                    </span>
                    <b>{n.title}</b>
                  </span>
                  <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: STATUS[n.status].bg, color: STATUS[n.status].fg }}>
                    {STATUS[n.status].label}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">{n.body}</p>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {n.points.map((p) => (
                    <li key={p} className="flex gap-2">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]" aria-hidden />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <section className="p-5">
          <h2 className="text-lg font-extrabold">This demo</h2>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            Everything runs on a local NEAR chain started with one command. Prices are real (Binance, with Coinbase as a
            fallback), pushed to a Pyth-compatible oracle; USDC and the buyback swap are local stand-ins. Planned integrations include Outlayer and Rhea, without real-network proof. The ordinary demo has live prices and 10-minute rounds; the separate judge profile has fixed controllable prices and 45-second rounds.
          </p>
        </section>
      </div>
    </div>
  );
}
