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

OneUp gives losers part of the house's profit back, as an asset they own. When a round closes with the house in profit, each wallet with a net loss gets a Life NFT: an NFT that collects a share of the house's profit for the next 13 rounds, up to 1.2-2x its face value. Losers also get $1UP, locked for 104 rounds; lockers share the house's buybacks. A Life can be claimed, kept or sold: the buyer gets its unclaimed USDC and future payouts, and the former owner can't claim them. Recovery depends on future house profit and can be zero.

NEAR makes the Life an NFT that holds money: NEP-171 with on-chain art, claiming NEP-141 USDC, sold on a built-in market. Deposits go through the official NEAR Intents Verifier: one signed intent swaps a bridged token, deposits it and opens a trade, and the house lets it trade only that deposit. A Sputnik DAO owns the house, the Lives and the oracle. One-tap trading uses function-call keys and a NEP-366 relayer. AI agents trade through an MCP server that journals each action with the agent's reason.

To try it: open https://oneup.markets (NEAR testnet, with or without a wallet). The NFTs, claims, locks and market run on testnet; Intents, the DAO, one-tap trading and agents run in the local demo, where pnpm demo:judge starts an isolated chain with a prepared Life and a listing to buy, and pnpm test:judge checks the loop end to end.

OneUp is a prototype using test USDC. The bridge, oracle, swap and vault are mocks, nothing is on mainnet, and demand for buying Lives is untested.
```

## Demo thread (for the author to post)

The rules ask for a post that leads with the user problem, shows one complete moment and says what NEAR does. Each
post fits 280 characters with its links (X counts a link as 23). The repository must be public before post 9 goes out.

1 (the ad):
```text
Got liquidated. Got paid.

On most perps, your loss is the house's profit. On OneUp, a net loss can earn a Life NFT: a NEAR NFT that collects USDC from future house profit. Claim it or sell it.

Built at NEAR HACKATHON
https://oneup.markets

@NEARProtocol #NEARHackathon
```

2:
```text
The problem: when you trade against a house and get liquidated, that's the end of it. Your margin is gone, and the house keeps all of it.

So what if the people who fund the house's profit got a share of it back, as something they actually own?
```

3:
```text
How a round works:

1. Go long or short on BTC, ETH or NEAR, up to 1000×
2. Lose, or get liquidated
3. If the house ends the 30-minute round in profit, every wallet with a net loss gets a Life NFT

No entry or funding fees. Winners pay 10–25% of their profit.
```

4:
```text
A Life NFT collects a share of house profit for the next 13 rounds, up to 1.2–2× its face value.

Its face value comes from your share of the round's losses, and is never more than your loss.

Payouts can be zero. It's a claim on future profit, not a refund.
```

5:
```text
It's yours to sell. List your Life NFT on the built-in market, and the buyer gets its unclaimed USDC and every payout after.

So a bad trade leaves you holding an asset with a price, and someone else can bet on the house's future profit.
```

6:
```text
What NEAR does here: each Life NFT is a NEP-171 token that claims NEP-141 USDC from the house.

Its picture is drawn on-chain from its balance, so NearBlocks shows the heart filling up as it pays. Sell the NFT and the future payouts go with it.
```

7:
```text
In a profitable round, losers also get $1UP, locked for 104 rounds. Locks are NFTs too: they share the house's buybacks and show a padlock that drains as the unlock nears.

Each $1 of net loss also adds a jackpot ticket, with a prize from simulated vault interest.
```

8:
```text
Beyond testnet, the local demo runs what's next: deposits through NEAR Intents with a simulated bridge, a Sputnik DAO owning the house, one-tap gasless trading, and AI agents trading through an MCP server.

That part runs on a local chain. `pnpm demo:judge` starts it.
```

9:
```text
Try it: https://oneup.markets

NEAR testnet, test money, with bots providing the flow. The oracle, swap and vault are mocks, the contracts aren't audited, and the ad's characters are AI-generated.

Code: https://github.com/ethboi/oneup

Would you buy a stranger's Life NFT?
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
