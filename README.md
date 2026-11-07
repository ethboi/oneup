# OneUp

**Perpetuals on NEAR where a losing trade can leave you a Life NFT: an NFT that holds USDC and a share of
the house's future profit, which you can claim or sell.**

When one sells, the buyer gets its unclaimed USDC and every payout still to come. A purchase names the listing
the buyer saw, so one the seller claimed or repriced in the meantime fails and refunds the buyer.

![A 50× long is liquidated; when the round closes the loss becomes a Life NFT, whose USDC is claimed](docs/media/oneup.gif)

A NEAR HACKATHON entry for **NFTs That Do Something**, **Unstoppable DeFi** and **Agent Economy**. It is live
on NEAR testnet at **https://oneup.markets** (the app is at https://app.oneup.markets), and runs as a fuller
local demo, both with test USDC; nothing is on mainnet. All of it was written in the
hackathon window: the first commit is 20 October 2026, the day after the announcement
(`git log --reverse --format=%ad | head -1`).

## The problem

On a perpetuals venue that trades against its users, a trader's loss is the venue's profit, and a liquidated
position leaves the trader nothing to hold, sell or claim.

OneUp gives losers part of the house's profit back, as an asset they own. When a round closes with the house
in profit, each wallet with a net loss in that round gets a **Life NFT**, an NFT that collects a share of the
house's profit for the next 13 rounds, up to a payout limit of 1.2–2× its face value. A round pays out only from
the surplus above the pool's reserve, so a profitable round can still pay nothing. Losers also get $1UP tokens,
locked for 104 rounds; lockers share the house's buybacks. A Life can be claimed, kept or sold: the buyer gets
its unclaimed USDC and its future payouts. Recovery depends on future house profit and can be zero.

## What NEAR does here

- **NFTs that hold money.** Each Life NFT is a NEP-171 NFT (with NEP-177 metadata and NEP-178 approvals)
  whose owner can claim the USDC (NEP-141) allocated to it; transferring it moves the claim. Its SVG art is
  generated on chain from its state. Events follow NEP-297.
- **NEAR Intents.** Deposits go through the official Intents Verifier (v0.4.2, unchanged): one signed intent
  swaps a bridged token for USDC, deposits it and opens a trade, and the house checks that an intent can trade
  only the deposit it brings. Locally, PoA tokens stand in for bridged assets and OneUp runs its own solver.
- **Sputnik DAO.** A DAO running unchanged mainnet Sputnik v2 code owns the house, the Life NFTs and the
  oracle: markets, parameters and the keeper change by council vote.
- **Function-call keys and NEP-366.** One-tap trading uses a session key that can only call the house's
  trading methods, and a relayer pays the gas.
- **AI agents.** An MCP server gives an agent the trader's tools, including buying Lives on the market; every
  action is journalled, with the agent's stated reason when it gives one, and shown on the app's Agents tab.

The NFTs, USDC claims, locks and market run on testnet; Intents, the DAO, one-tap trading and agents run in the
local demo.

## Try it live

| Step | Do | See |
|---|---|---|
| 1 | Open https://oneup.markets, then **Open the app** | What OneUp is, then the app's power-on screen (any key skips it) |
| 2 | On the wallet screen choose **Look around first** | The Trade screen with no wallet: the live chart and the long/short split. Any action asks for a wallet |
| 3 | Open the **Market** tab | The Lives and locks the bots have listed |
| 4 | **Connect wallet** (a NEAR testnet wallet such as Meteor; see [wallet setup](docs/NEAR_WALLET_SETUP.md)), then in the account menu **Register test tokens** and **Get 1,000 test USDC** | Test USDC in your wallet |
| 5 | Open a 1000× long on NEAR-USD | The order fills on the next price. A small move against it liquidates it, with the LIQUIDATED banner |
| 6 | Wait for the round to close (the countdown is in the header), then open **Life NFTs** | If the house ended the round in profit, your Life NFT, its picture filling as it pays |
| 7 | **Claim** what it has collected, or list it on the **Market** | USDC in your wallet, or your listing |

The testnet contracts are accounts under `v5.oneupmarkets.testnet`. Nobody holds a key to them and none can deploy new
code, but that account owns them and can still change settings such as the oracle and market limits. The keeper and
bots run from the author's machine, along with an indexer that feeds the app's history and leaderboards.

## Try it locally

Tested on Linux with Node 24.13.0, pnpm 10.18.3, Rust 1.99.1 (with the `wasm32-unknown-unknown` target) and
cargo-near 0.22.0, the versions CI uses.

| Step | Do | See |
|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | Dependencies installed |
| 2 | `pnpm preflight --compile` | Every line ✓. Without cargo-near it also checks the tools needed to build it |
| 3 | `pnpm build:contracts` | Nine WASM files under `contracts/target/near/` |
| 4 | `pnpm demo:judge`, and leave it running | After about five minutes `Judge app: http://127.0.0.1:3021`; about a minute later `Ready.`, naming a prepared Life and a listing |
| 5 | Open http://127.0.0.1:3021 | The Trade screen, as the `demo` trader: the NEAR-USD chart, the order ticket with its potential recovery, and How recovery works |
| 6 | Open the **Life NFTs** tab | A Life from a prepared loss, with USDC available to claim and a remaining payout limit. **Claim** sends the USDC to the wallet |
| 7 | Open the **Market** tab | bot3's Life. bot3 claimed its USDC, then listed the Life for a fifth of its remaining payout limit; whatever later rounds have paid it since goes with it. **Buy** moves it to your Life NFTs, where its USDC and its future payouts are yours to claim |
| 8 | In a second terminal: `ONEUP_CONFIG=<path printed in step 4> pnpm test:judge` | Eleven assertions pass in one to two minutes: fills, liquidation, Life minted, USDC claimed, sale, former owner refused, buyer claims, reserve admission, deployed hashes, DAO ownership. `e2e.json` is written beside the config |
| 9 | On the Trade screen, open a 50× long on NEAR-USD; then `curl -XPOST 127.0.0.1:8887/price -H 'content-type: application/json' -d '{"market":"NEAR-USD","movePct":-2}'` | The keeper liquidates the position; when the 45-second round closes, a new Life appears on the Life NFTs tab |
| 10 | `pnpm agent` (needs `ANTHROPIC_API_KEY` or the `claude` CLI) | An AI agent trades as bot12; the **Agents** tab lists each action and the reason it gave |
| 11 | `pnpm verify` | About seven minutes: a secret scan, typechecks, Rust unit, property and sandbox tests, TypeScript tests and a production build, ending `Complete verification passed` |

`pnpm demo:judge` starts a fresh chain under `.judge/<time>/` on every run and never touches the regular demo.
It uses ports 3021 (app), 3130 (RPC), 8887 (price control) and 25567, and refuses to start if one is taken
(`ONEUP_JUDGE_APP_PORT=3022` and the like move them). Prices stay fixed until you steer them and no bots run.
The prepared sample is scripted and recorded in `prepared.json`; `pnpm demo:judge --empty` skips it. Ctrl-C
stops everything.

`pnpm demo` runs the ordinary demo instead: live prices, twelve bots and ten-minute rounds at
http://127.0.0.1:3020, with state kept in `.localnet/`.

## Check the claims

**On the live deployment, in about a minute.** You need Node 18 or newer and nothing else: no install, no wallet and no
keys, and it sends no transactions.

```bash
git clone https://github.com/ethboi/oneup && cd oneup
node scripts/check-live.mjs
```

It reads the contracts on NEAR testnet and prints `PASS` or `FAIL` for each claim, with the numbers behind it: nobody
holds a key to the nine contracts, prices are fresh, rounds keep closing, every open position's worst case fits inside
the pool, Lives come only from house profit, the USDC Lives received matches the rounds exactly, unclaimed USDC is
really in the contract, Lives have been sold and the buyer collected, and the pictures are on chain. It ends with what
it can't prove, including that the money is test money, the oracle is a mock and the traders are the author's bots. A
`FAIL` on prices or rounds usually means the keeper on the author's machine has stopped.

**In the code, by running the tests.**

| Claim | Code and regression | Run and see |
|---|---|---|
| Selling a Life transfers its payout rights | [Life NFT](contracts/extra-life/src/lib.rs), [market test](contracts/tests/tests/market.rs), [judge journey](scripts/judge-e2e.ts) | `pnpm test:judge`: the buyer owns and claims it; the former owner is refused |
| A purchase can't land on a changed listing | [Market](contracts/market/src/lib.rs), sandbox `a_life_claimed_and_listed_again_is_not_sold_to_the_earlier_buyer` | `pnpm test:sandbox`: a Life claimed and listed again at the same price refunds the earlier buyer |
| An NFT emptied during a transfer call can't sell on its old listing | [Life NFT](contracts/extra-life/src/lib.rs), [ve](contracts/ve/src/lib.rs), tests `a_life_emptied_during_a_transfer_call_returns_without_its_old_approvals` and `a_lock_emptied_…` | `pnpm test`: the token returns without its old approvals; one left untouched keeps them |
| A Life is never sized above its loss | [Maths](contracts/math/src/lib.rs), house `a_quiet_rounds_fees_dont_inflate_its_lives` | `pnpm test`: a quiet round's marketplace fees don't inflate the round's Lives or $1UP |
| Failed issuance keeps the obligation | [Recovery queue](contracts/house/src/recovery.rs), [receipt test](contracts/tests/tests/recovery.rs) | `pnpm test:sandbox`: a failure and retry keep the recipient and terms without duplicating rewards |
| Expiry stops future payouts, not allocated cash | [Life tests](contracts/extra-life/src/tests.rs), [UI accounting](app/test/life-economics.ts) | `pnpm test` and `pnpm test:ts`: expired cash stays claimable; the remaining payout limit is zero |
| Admission reserves the worst case | [House property tests](contracts/house/src/tests.rs) | `pnpm test`: random sequences of trades never let liability exceed the pool |

[The evidence index](docs/evidence/README.md) keeps earlier recorded runs, with the exact revisions they ran on.

## What is real and what is mocked

| Component | State |
|---|---|
| House, Life NFT, $1UP token, locks, marketplace | OneUp's own contracts, on testnet and the local chain |
| NEAR Intents | The official Verifier and PoA token factory (v0.4.2, unchanged binaries); intents signed with the official SDK. OneUp's own solver fills them with `execute_intents`. Bridge deposits are simulated; there is no real Ethereum or Solana deposit and no 1Click integration |
| Sputnik DAO | Local demo only (an operator account owns the testnet contracts). Unchanged mainnet Sputnik DAO v2 code; owns the house, the Life NFTs and the oracle. The council (the demo trader, bot4 and bot6) votes with disclosed test keys |
| Function-call keys, NEP-366 | Session keys limited to the house's trading methods; a local relayer. A trade-only key can still lose the trading balance |
| NEAR wallet | NEAR Connect 0.11.4 on testnet, described in [wallet setup](docs/NEAR_WALLET_SETUP.md). The local demo signs with its test accounts |
| AI agents | The MCP server and `pnpm agent`. The agent signs with a full-access local test key; its limits on margin, leverage and stop-losses are instructions, not enforced in code |
| Oracle | A mock with Pyth's interface. The keeper feeds it Binance prices (ordinary demo) or fixed prices (judge demo). Pyth through OutLayer is the plan and hasn't been tested on a real network |
| Swap, vault, USDC | Mocks: a constant-product swap for buybacks (Rhea is the plan), a vault paying 5% on idle pool USDC (lending through Chain Signatures is the plan), and test USDC with a faucet |
| Randomness | The jackpot draw uses NEAR's block random seed |

## Rules and limits

- **Trading.** USDC margin, up to 1000× leverage, and a maximum profit of 9× margin. No entry or funding fee;
  winners pay 10–25% of their profit. A 90% loss liquidates the position and takes its whole margin. A
  position can be closed after 60 seconds. Orders fill at an oracle price published after they were placed,
  by a trusted keeper. A limit order rests up to 24 hours, and can be cancelled after its first 30 seconds.
- **Admission.** The pool must cover the maximum win of every open position and pending open, longs and shorts
  together, so it can always pay; this doesn't remove oracle, owner, vault or implementation risk.
- **Life NFTs.** Sized from the round's house profit, up to the round's net losses, by each wallet's share
  of those losses: a Life's face value is never more than its loss. Lives share 60% of half the surplus above
  the reserve each round, two thirds to trader Lives and one third to Backer Lives.
- **$1UP.** 1B minted once: 900M released to losers over four years, 20 per USDC of the house profit behind
  their Lives, as 104-round locks; 50M for liquidity, 42.5M treasury and 7.5M for backers. Lockers earn
  buybacks by amount × time left; leaving early costs up to half.
- **Backing.** The local deployment starts with a $250K house seed and $100K of bot backing, which earn Backer
  Lives that never expire. These are prepared state, not users or traction.
- **Market.** Lives and locks are NFTs listed for USDC; sellers pay a 2% fee to the house. No price or buyer
  is guaranteed.

The design borrows from Papertrade (loss-linked claims) and Aerodrome (revenue-sharing locks). The maths is in
[docs/maths.md](docs/maths.md) and every decision in [docs/decisions.md](docs/decisions.md).

## AI agents

The MCP server (`mcp/`) gives any MCP client thirteen tools: `how_it_works`, `markets`, `account`,
`quote_trade`, `open_trade`, `close_trade`, `set_triggers`, `extra_lives`, `claim_lives`, `house`,
`market_listings`, `buy_listing` and `faucet`. An agent can treat a Life as an asset: buy one listed below the
USDC it can still pay, then claim it. Every action takes the agent's reason, and goes into a journal beside
the chain's state that the Agents tab shows.

```bash
pnpm mcp                      # stdio. Claude Code in this folder loads it from .mcp.json
ONEUP_ACCOUNT=bot3 pnpm mcp   # trade as another bot
pnpm agent                    # one autonomous session: the Claude API with ANTHROPIC_API_KEY, else the claude CLI
```

The server uses `ONEUP_CONFIG` if set, else the ordinary demo's `localnet.json`, else the newest judge chain.
By default the agent trades as bot12, which the rule-based bots leave alone.

## Economics

`pnpm test:economics` runs funded experiments against the real contracts: admission, inactive rounds and
expiry, an adverse house result, and two wallets farming each other; its report reconciles cash, fees and
remaining rights ([scope and results](docs/ECONOMIC_EXPERIMENTS.md)). `pnpm sim:sensitivity` models flat and
falling activity, negative edge and high utilisation across random seeds. These show how the mechanism
behaves; they don't prove demand or that recovery is sustainable. A [five-person research protocol](docs/USER_RESEARCH.md)
is prepared, with no results yet.

## Commands

| Command | Purpose |
|---|---|
| `pnpm preflight --compile` / `--judge` | Check build prerequisites / the built WASM and the judge demo's ports |
| `pnpm demo:judge` / `pnpm test:judge` | Isolated, controlled demo / its end-to-end check |
| `pnpm test:judge:ci` | A fresh isolated deployment, the end-to-end check and a Chromium test of listing, buying and claiming (run `pnpm exec playwright install --with-deps chromium` first) |
| `pnpm verify` | The full gate; writes source-bound logs to `.verification/` |
| `pnpm test` / `pnpm test:sandbox` / `pnpm test:ts` | Rust unit, property, SDK and model tests / integration tests on fresh WASM / app and keeper tests |
| `pnpm test:economics`, `pnpm sim:sensitivity`, `pnpm farm` | Funded experiments, adverse scenarios, farming comparison |
| `pnpm demo` | The ordinary demo: live prices and twelve bots |
| `pnpm mcp` / `pnpm agent` | The MCP server / one autonomous AI agent session |
| `pnpm verify:deployment` | Compare the deployed contracts with the local WASM |
| `pnpm localnet:reset` | Delete the ordinary demo's chain (the judge demo doesn't need it) |

## Built with

- **AI-written code.** OneUp was written with Claude Code (Anthropic's coding agent), directed and reviewed by
  the author. Commits it co-wrote carry a `Co-Authored-By: Claude` trailer, which is nearly all of them:
  `git log --grep='^Co-Authored-By: Claude' --oneline | wc -l`. No starter template or boilerplate was used.
- **Contracts.** near-sdk and near-contract-standards 5.29.1; tests use near-workspaces 0.23.0, proptest and
  tokio.
- **Third-party contracts, deployed unchanged.** NEAR Intents Verifier and PoA token factory v0.4.2, wNEAR, and
  Sputnik DAO v2; sources and hashes in [contracts/vendor](contracts/vendor/README.md).
- **App.** Next.js 16.4.3, React 19.2.9, Tailwind CSS 4.3.3, near-api-js 7.3.1, NEAR Connect
  (`@hot-labs/near-connect` 0.11.4), the NEAR Intents SDK (`@defuse-protocol/intents-sdk` 0.92.0), borsh 2.0.0,
  and the Pixelify Sans and M PLUS Rounded 1c fonts from Google Fonts.
- **SDK, keeper and bots.** near-api-js 7.3.1. Live prices come from Binance's and Coinbase's public APIs.
- **MCP server and agent.** `@modelcontextprotocol/sdk` 1.30.1, zod 4.6.5, `@anthropic-ai/sdk` 1.3.0.
- **Tooling.** TypeScript 6.0.3, tsx, Vitest, Playwright 1.64.1, near-sandbox 0.3.4, cargo-near 0.22.0.

Licences for these are in [third-party notices](THIRD_PARTY_NOTICES.md).

## Repository

- `contracts/`: five product contracts, four mocks, shared integer maths and sandbox tests on built WASM.
- `packages/sdk/`: typed calls and the maths mirrored for previews. `keeper/`: prices, fills, rounds, retries.
- `app/`: the Next.js app. `bots/`: synthetic demo traders. `mcp/`: the MCP server and `pnpm agent`.
- `sim/`: economic models. `scripts/`: chain, deploy, judge demo and verification.
- Docs: [security](docs/SECURITY.md), [maths](docs/maths.md), [interfaces](docs/interfaces.md),
  [decisions](docs/decisions.md), [the recovery journey](docs/RECOVERY_JOURNEY.md),
  [hackathon readiness](docs/HACKATHON_READINESS.md), [submission draft](docs/SUBMISSION.md).

## Licence

Original OneUp code and documentation are **AGPL-3.0-only**: see [LICENSE](LICENSE) and [NOTICE](NOTICE).
Third-party binaries, dependencies and marks keep their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
