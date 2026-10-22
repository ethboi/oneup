# NEAR HACKATHON submission (draft)

A draft of the form, to check before sending. **One submission, not editable.** Submissions open
2026-11-01T00:00Z and close 2026-11-14T23:59Z (research R-1 in [decisions.md](decisions.md)).

## Before submitting

- [ ] Check the rule on code written before 1 Nov (R-1: the site says "build your project during the
      hackathon"; ask in the NEAR Discord if unsure).
- [ ] Make the repo public.
- [ ] Post on X with a video or screenshots, saying it was built at NEAR HACKATHON.
- [ ] Fill the fields below that are left blank.

## Fields

| Field | Value |
|---|---|
| Project name | OneUp |
| Lead | _(your name)_ |
| Email | _(your email)_ |
| Team size | _(fill in)_ |
| Tracks | _(pick from the form's list)_ |
| NEAR wallet | _(fill in)_ |
| Repo | https://github.com/ethboi/oneup (public before submitting) |
| X post | _(link)_ |

## Description

The form allows 20 to 2,000 characters. This draft is 1,869.

```text
OneUp is a perpetuals exchange on NEAR where losing isn't the end of the story. Lose a trade, get a life.

Think Papertrade meets Aerodrome: a loss buys a claim on the house, and a locked token earns by size and time left, without the payout queue, the forever-claims or the bribes.

Traders go long or short up to 100x against one USDC house pool, at the oracle price, with no fees, funding or slippage. Any trade the pool couldn't pay in the worst case is refused, so the house can't go bust and there is never a payout queue.

When an epoch ends with the house in profit, its losers get Extra Lives: NFTs that earn USDC back from the house's later profit, up to a cap, for 13 epochs. Lives expire, so early claims can't crowd out new players: in our simulation a dollar lost in year three gets back about what one lost early does. Losers also get $1UP, released only by real house profit and locked for two years; locks earn the house's buybacks by size and time left. Extra Lives and locks can be sold on the built-in market at any time.

Anyone can back the house in its bootstrap round for a Backer Life that never expires; the first dollar is owed 2x, the last 1.2x.

Built on NEAR: pay from Ethereum or Solana in one signed NEAR Intent, a Sputnik DAO owns the house, one-tap gasless trading with a trade-only key, and Extra Lives drawn on chain. Orders fill at the next oracle price, so nobody trades on a price they already know.

What's in the repo: 9 Rust contracts with 177 tests and a security review (docs/SECURITY.md), a keeper, twelve trading bots, an MCP server so AI agents can trade, simulations of fairness and farming cost, and a Next.js app with live prices, history, shareable PnL cards and sound. One command (pnpm demo) starts a local NEAR chain with everything deployed. On mainnet the house reads Outlayer's Pyth oracle and buys back on Rhea.
```
