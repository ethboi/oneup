# Five-person research protocol

**Status: prepared; no participants recruited, no sessions completed and no demand established.**
Use [the blank results template](USER_RESEARCH_RESULTS.md). The goal is to learn whether someone wants
transferable recovery rights after understanding the cost and uncertainty. A test purchase or a favorable
comment is not evidence of willingness to pay real money.

## Participants and session setup

Recruit five independent adults with relevant experience: two active derivatives traders, two people
who have bought yield/claim-like assets, and one person who evaluates liquidity provision or backing.
Record prior experience and any relationship to the team; do not silently replace reluctant participants.
All five assess trader, buyer and seller tasks, followed by a backing question. This small exploratory
sample is not representative market research. Recruitment and contact are separate human steps.

Run individual 25–35 minute sessions. Obtain consent to notes/recording; use P1–P5, keep contact details
outside the repository, and record only with permission. Use local/testnet assets only. Do not request
seed phrases, funds or a mainnet transaction. Keep compensation, if any, independent of positive feedback
and purchase choices. Let participants decline. Show the current revision and disclose all prepared state.

Start neutrally: “Please explore this trading and recovery prototype. Tell me what you think you own,
what you can claim and what could change. You can decline every action.” Avoid explaining the product
until the first attempt has been observed. Record mistakes and assistance before clarifying them.

## Tasks and neutral questions

1. **Trader:** inspect a proposed trade before placing it. Explain the margin at risk, 10–25% fee on profits,
   9× margin profit cap before fee, liquidation taking the full margin, and minimum voluntary hold.
   Ask: “How could this leave you worse off than the trading service you use today?”
2. **Life owner:** inspect a Life and explain the current owner, available USDC, remaining payout limit
   and expiry. Ask: “What must happen before you receive more? What happens to already allocated cash
   when this expires? What changes after you sell it?” Let the participant find the answers first.
3. **Buyer and seller:** present the three hypothetical cards below in rotated order. Ask for a buyer's
   maximum price and a seller's minimum price separately, before showing any other person's prices or
   a seeded market listing. “I would not buy/sell” is a valid answer. Record confidence, time horizon,
   required evidence and the reason; ask what alternative they would use.
4. **Ownership:** list and transfer a prepared test Life to a second test identity; have the participant
   explain who can claim. Observe buyer claim and former-owner denial. Clearly distinguish this usability
   exercise from their independent hypothetical purchase choice.
5. **Backer:** explain that backing permanently joins the pool, a Backer Life has no expiry, payouts
   depend on house profit, and selling requires a buyer. Ask: “Would you consider contributing? What
   evidence and compensation would you need? How would you recover principal?” Do not equate a percentage
   of payout caps paid with a return on contributed principal.

## Scenario cards

These are hypothetical values, not live quotes or forecasts. Reveal all facts simultaneously, including
the 2% marketplace seller fee and transaction costs. Do not suggest a fair price. Compare seller net
proceeds (`ask × 0.98`, before transaction costs) with the option of claiming existing cash directly.
A seller claim invalidates the existing NFT approval; a later buyer cannot rely on that stale listing.

| Card | Available to claim | Maximum additional payout | Earning window | Important choice |
|---|---:|---:|---|---|
| Cash only | 20 test USDC | 0 | Expired; allocated cash remains claimable | Why sell at all, instead of claiming 20? What verification/cost changes a buyer's bid? |
| Future only | 0 | 40 test USDC | Three rounds left; future payout may be zero | What supports a positive price when there is no allocated cash? |
| Mixed | 8 test USDC | 12 test USDC | Two rounds left; future payout may be zero | Price present cash and uncertain future rights separately; the maximum is not expected value. |

Rotate orders P1/P4: cash–future–mixed; P2/P5: future–mixed–cash; P3: mixed–cash–future. Keep buyer and
seller price sheets independent. Do not reveal another participant's answer or “correct” a low bid.

## Comprehension and decision rules

Before prompting, score these eight facts as correct / incorrect / unknown: profit fee; full-margin
liquidation; recovery not guaranteed; cap not current cash; expiry preserves allocated cash; ownership
transfers rights; seller can claim instead; backing principal is not withdrawable. Then explain mistakes,
retest and record both attempts. Never overwrite an initial misunderstanding with a coached answer.

Proposed usability target: at least four of five participants correctly explain the four critical recovery
facts (conditional payout, cash versus cap, expiry, ownership) without coaching. This is a future target,
not a result. Any misconception of a guaranteed refund blocks that claim in the demo and triggers copy
or flow changes. Repeated inability to find a Life or identify its owner triggers navigation changes.

Demand has no pass/fail claim from five hypothetical bids. Report all bids, asks and refusals; count
possible bid/ask overlaps without treating them as transactions. Future-only bids of zero, large seller/buyer
gaps, or “I would just claim” responses are product findings. Use them to choose a narrower customer,
change the mechanism or deprioritize the marketplace before adding more integrations.

Deliver a concise anonymized synthesis: what people understood, why they would or would not use it,
which assumptions failed, exact changes made, and what remains unproven. Do not report bot activity,
prepared sales or research compensation as traction.
