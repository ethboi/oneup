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
    body: "Go long or short with up to 1000× leverage, using the oracle price. All trades use one USDC pool. There are no entry or funding fees; profitable trades pay 10–25% of profit. The house reserves funds for each trade’s maximum payout. This depends on the custody system, oracle and contracts working correctly.",
  },
  {
    icon: <PixelHeart size={22} />,
    title: "Receive an Extra Life",
    body: "If you have an eligible net loss in a profitable house round, you receive an Extra Life. This NFT can receive USDC from house profits during its 14-round earning period, up to a payout limit. Payouts are not guaranteed.",
  },
  {
    icon: <PixelCoin size={22} />,
    title: "Receive locked $1UP",
    body: "Eligible losses also earn $1UP when the house makes a profit. These tokens are locked for 104 rounds and receive a share of buybacks, based on the amount locked and the time remaining.",
  },
  {
    icon: <Icon name="store" size={22} />,
    title: "Keep or sell your NFT",
    body: "Extra Lives and $1UP locks are transferable NFTs. You can list them for USDC on the built-in market. A sale needs a willing buyer, and future payouts are not guaranteed.",
  },
];

/** Where each half of the design comes from, and what OneUp changes in it. */
const LINEAGE: { from: string; idea: string; rows: { topic: string; them: string; oneup: string }[] }[] = [
  {
    from: "Papertrade",
    idea: "Losses can earn a share of house profits",
    rows: [
      { topic: "What a loss gets you", them: "PAPER tokens, 100 per $1 lost, staked for a share of profit", oneup: "An Extra Life with a USDC payout limit, plus locked $1UP" },
      { topic: "How payouts are covered", them: "Unpaid winnings enter a queue", oneup: "Trades are rejected if their maximum profit payouts exceed available capacity; custody, oracle and contract risks remain" },
      { topic: "How long a claim lasts", them: "Claims do not expire, so early claims continue to compete with later ones", oneup: "The minting round plus 13 more rounds; payouts depend on house profits" },
    ],
  },
  {
    from: "Aerodrome",
    idea: "Rewards based on lock size and time remaining",
    rows: [
      { topic: "The lock", them: "AERO locked up to 4 years as a veAERO NFT", oneup: "$1UP locked for up to 104 rounds as an NFT; reward weight is the amount × time remaining" },
      { topic: "What it earns", them: "Fees and bribes from the pools you vote for", oneup: "A share of house buybacks, without voting or bribes" },
      { topic: "Getting out early", them: "Sell the NFT on another marketplace", oneup: "Exit early and pay a penalty to remaining holders, or sell on the built-in market" },
    ],
  },
];

const BUILT: { icon: IconName; title: string; body: string }[] = [
  { icon: "shield", title: "9 Rust contracts", body: "House, Extra Life (NEP-171), $1UP (NEP-141), locks, market (NEP-178 approvals), and mock USDC, oracle, swap and yield vault. Events follow NEP-297." },
  { icon: "check", title: "Tests for failures and recovery", body: "Tests cover contract logic, generated edge cases, SDK flows and integrations with fresh local contracts. Run pnpm verify to check the current version. Review findings and regression coverage are documented in docs/SECURITY.md." },
  { icon: "demo", title: "Keeper and bots", body: "A keeper updates prices, fills orders, liquidates positions, executes take-profit and stop-loss orders, and closes rounds. Only the configured keeper, owner or operator can fill orders. Twelve trading bots exercise the app, and an MCP server lets AI agents trade too." },
  { icon: "scale", title: "Simulations", body: "Models explore how profit, growth and trading across one or several wallets affect recovery. They do not prove market demand, fair outcomes or resistance to abuse through multiple wallets." },
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
      "Contract access keys are deleted after deployment. Administrative methods built into the contracts still remain",
      "Payouts, minting and vault withdrawals use cross-contract calls and callbacks",
    ],
  },
  {
    title: "NEAR standards",
    marks: [{ name: "near", label: "NEAR" }],
    status: "demo",
    body: "Tokens, NFTs and events use NEAR standards for compatibility with wallets, explorers and indexers.",
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
    body: "Simulate funding from Ethereum or Solana, then execute a signed swap and deposit on the local Intents Verifier.",
    points: [
      "The official Verifier and PoA token factory (release 0.4.2) run on the local chain",
      "Intents are signed with the official SDK; OneUp's solver fills them with execute_intents",
      "Real Ethereum and Solana deposits and 1Click are not integrated. Initial setup may require an extra signature",
    ],
  },
  {
    title: "Sputnik DAO",
    marks: [{ name: "dao", label: "Sputnik DAO" }],
    status: "demo",
    body: "A DAO owns the house, the Extra Lives and the oracle: the same Sputnik DAO v2 code mainnet DAOs run.",
    points: [
      "Changes to market listings, pauses, parameters, the keeper and the yield vault require council votes",
      "View proposals and vote on the House tab",
    ],
  },
  {
    title: "Function-call keys (session keys)",
    marks: [{ name: "near", label: "NEAR" }],
    status: "demo",
    body: "One-tap trading uses a session key restricted to the house’s trading methods.",
    points: ["The key can open and close positions and set exit orders. It cannot withdraw tokens directly, but trading can still lose your balance", "Turning off one-tap trading deletes the key"],
  },
  {
    title: "Meta transactions (NEP-366)",
    marks: [{ name: "near", label: "NEAR" }],
    status: "demo",
    body: "The app signs your trade request, and a relayer pays the network fee.",
    points: ["The relayer only submits house trading calls, with limits on gas and request frequency"],
  },
  {
    title: "Chain Signatures",
    marks: [{ name: "near", label: "NEAR" }],
    status: "mainnet",
    body: "Planned: manage an Ethereum yield position from the house’s NEAR contract.",
    points: [
      "The proposed design would use an Ethereum address controlled through Chain Signatures to lend idle USDC, with transfers through NEAR Intents",
      "The DAO would choose the lending venue, without a person holding the private key",
      "The local demo uses a mock vault with a simulated 5% annual yield",
    ],
  },
  {
    title: "Pyth prices via Outlayer",
    marks: [{ name: "pyth", label: "Pyth" }, { name: "outlayer", label: "Outlayer" }],
    status: "simulated",
    body: "Orders fill using a price published after the order was placed. Liquidations use the latest valid price. Timely execution still depends on the keeper.",
    points: [
      "In local live-price mode, the keeper sends Binance prices to a mock oracle with a Pyth-compatible interface",
      "An Outlayer-compatible interface is implemented, but deployment and price feeds on a real network remain unverified",
      "The house checks price age and confidence, and rejects future timestamps",
    ],
  },
  {
    title: "Rhea",
    marks: [{ name: "rhea", label: "Rhea" }],
    status: "mainnet",
    body: "Rhea is the planned buyback venue. The demo uses a mock swap contract; a real Rhea adapter has not been built.",
    points: ["The local swap interface is specific to the demo", "50M $1UP is minted at launch to seed liquidity"],
  },
  {
    title: "NEAR randomness",
    marks: [{ name: "near", label: "NEAR" }],
    status: "demo",
    body: "The jackpot draw uses NEAR’s block random seed when a round closes.",
    points: ["OneUp uses NEAR’s randomness rather than Pyth Entropy, which runs on EVM chains"],
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
    body: "OneUp is built to be traded by AI agents as well as people. An MCP server gives an agent the trader’s tools: markets, quotes, open and close, exit orders, Life claims, and buying Extra Lives and locks on the market. Each action carries the agent’s reason, shown on the Agents tab.",
    points: [
      "pnpm agent runs one autonomous Claude session over these tools; the bots leave its account (bot12) to it",
      "Configured in .mcp.json. On the local demo it signs with a bot account’s full-access key, without a separate spending limit",
    ],
  },
];

export function About() {
  return (
    <div className="flex flex-col gap-4">
      <section className="case relative overflow-hidden p-5 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="label">
              In development for NEAR HACKATHON · November 2026 · By{" "}
              <a className="font-bold text-[var(--text)] underline decoration-dotted underline-offset-2" href="https://x.com/ethboi_" target="_blank" rel="noreferrer">
                ethboi
              </a>
            </p>
            <h1 className="display mt-2 text-4xl leading-tight sm:text-5xl">Lose a trade, get a life.</h1>
            <p className="mt-3 max-w-xl text-[var(--muted)]">
              OneUp is a perpetuals exchange on NEAR. Trade against a shared USDC pool, with funds reserved for each position’s maximum payout.
              Eligible losses can earn you an Extra Life: a tradable NFT that shares in house profits. You may recover some of your loss, or nothing.
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
            OneUp draws on two ideas: Papertrade’s profit-sharing claims for traders who lose, and Aerodrome’s
            locked-token rewards, weighted by the amount locked and time remaining. OneUp combines them with
            limited Life earning periods and a built-in NFT market.
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
              <b className="block">A chance to recover losses</b>
              <span className="text-[var(--muted)]">Eligible losses can earn a share of house profits through an Extra Life. The payout depends on available profit and may be zero.</span>
            </li>
            <li>
              <b className="block">A limited earning period</b>
              <span className="text-[var(--muted)]">Lives stop earning when they expire, while allocated USDC remains available to claim. This limits how long older claims compete with newer ones. The scenarios show how recovery changes under different assumptions.</span>
            </li>
            <li>
              <b className="block">Reward incentives</b>
              <span className="text-[var(--muted)]">$1UP rewards depend on house profit and are locked for 104 rounds. Combining gains and losses within one wallet does not prevent abuse through multiple wallets. Selling NFTs at a discount also affects the incentive to farm rewards.</span>
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
          <p className="label mt-1 max-w-3xl">The tools and standards behind OneUp, with a clear status for each: working in the demo, simulated locally or planned for mainnet.</p>
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
            Everything runs on a local NEAR chain using test funds. Live-price mode sends Binance prices, with Coinbase as a
            fallback, to a mock oracle. USDC, swaps and yield are also simulated locally. Outlayer and Rhea integrations remain unverified on real networks. New standard demos use live prices and 10-minute rounds; existing demos keep their configured round length. The separate judge demo uses controllable prices and 45-second rounds.
          </p>
        </section>
      </div>
    </div>
  );
}
