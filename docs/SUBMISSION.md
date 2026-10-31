# NEAR HACKATHON submission: working draft, not submitted

All of OneUp was written in the hackathon window: the first commit is 20 October 2026, after the 19 October
announcement (Q-001), so there is no pre-event baseline to separate. Making the repository public, posting
the demo on X and submitting are the author's decisions; nothing here has been sent.

Tracks: `nfts` (lead), `defi`, `agents`, `open`. Recheck the [official site](https://nearhackathon.com/) and
[submission instructions](https://nearhackathon.com/HACKATHON.md) before submitting. As read on 31 October
2026: the deadline is 14 November 2026 at 23:59 UTC, the description must be 20–2,000 characters, a
local-only demo needs a public repository, a reproducible README and an X post with a video (Q-012), and
Claude Code and Codex screen every entry before the human jury (Q-017).

## Description draft

```text
On a perpetuals venue that trades against its users, a trader's loss is the venue's profit, and a liquidated position leaves the trader nothing.

OneUp gives losers part of the house's profit back, as an asset they own. When a round closes with the house in profit, each wallet with a net loss gets an Extra Life: an NFT holding USDC to claim now and a share of the house's profit for the next 13 rounds, up to 1.2-2x its face value. Losers also get $1UP, locked for two years; lockers share the house's buybacks. A Life can be claimed, kept or sold: the buyer gets its unclaimed USDC and future payouts, and the former owner can't claim them. Recovery depends on future house profit and can be zero.

NEAR makes the Life an NFT that holds money: NEP-171 with on-chain art, claiming NEP-141 USDC, sold on a built-in market. Deposits go through the official NEAR Intents Verifier: one signed intent swaps a bridged token, deposits it and opens a trade, and the house lets it trade only that deposit. A Sputnik DAO owns the house, the Lives and the oracle. One-tap trading uses function-call keys and a NEP-366 relayer. AI agents trade through an MCP server that journals each action with the agent's reason.

To try it: pnpm demo:judge starts an isolated local chain with a prepared Life and a listing to buy; pnpm test:judge checks the loop end to end; pnpm verify runs the Rust unit, property and sandbox tests, the TypeScript tests and a production build.

OneUp is a prototype on a local chain with test USDC. The bridge, oracle, swap and vault are mocks, nothing is deployed to testnet or mainnet, and demand for buying Lives is untested.
```

## Demo post draft (for the author to post)

The rules ask for a post that leads with the user problem, shows one complete moment and says what NEAR does.
It fits 280 characters with the link (X counts a link as 23). Attach the video from the [three-minute walkthrough](HACKATHON_READINESS.md#three-minute-walkthrough).

```text
Lose a trade, get a life.

OneUp: NEAR perps where a losing trade can leave you an Extra Life, an NFT holding USDC and a cut of future house profit. Claim or sell it.

Built at NEAR HACKATHON: <repository link>
Would you buy a stranger's Life?

@NEARProtocol #NEARHackathon
```

## Before submitting

- [ ] Lead name, email and team size.
- [ ] The mainnet NEAR account for a prize, chosen by the author.
- [x] Licence: AGPL-3.0-only for original code; third-party notices kept.
- [ ] The final revision passes `pnpm verify` and `pnpm test:judge`; CI has run on the public repository.
- [ ] Repository public; demo video recorded and posted on X; its link is the `demoUrl`.
- [ ] The description above rechecked against what's built and the 2,000-character limit.
- [ ] The author approves the exact payload before it's sent.

No bot, test balance or prepared sale should be described as a user, fundraising or demand. A session key's
method limits don't limit what allowed trading can lose.
