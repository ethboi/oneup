# Recovery journey

The recovery NFT is the primary product story. A Life detail link is
`/extra-lives#life=<URL-encoded token ID>` and works for NFTs owned by another account.
The view polls current ownership and only offers claim or sale to the selected owner.

## What the numbers mean

- **Available to claim:** already allocated, unwithdrawn USDC attached to the NFT.
- **Remaining payout limit:** the unallocated part of its maximum payout while it is eligible.
  It can pay zero. Expired or fully allocated Lives have no additional cap.
- **Allocated / withdrawn:** lifetime NFT totals, including previous owners. These do not measure
  the selected wallet's profit. The existing index cannot reliably attribute every historical
  account claim to one NFT, so no per-NFT transaction timeline is fabricated.
- **Earning rounds:** read from the house parameters. A Life earns in its originating round and
  the configured subsequent rounds. A closing round may still be settling after the counter advances.
  Backer Lives do not expire. Expiry stops allocations, not withdrawal of allocated funds.

The marketplace defaults to asking-price order and displays claimable funds, remaining payout limit,
earning window and price separately. Sellers enter their own price. Claiming after listing revokes the NFT approval: an old listing
can remain visible until refreshed, but a purchase against that approval fails and refunds the buyer.
The seller must list again after claiming. Displayed balances remain snapshots between polls.

## Durable issuance

Failed loss-Life and lock issuance retains a persisted on-chain batch with original recipients,
amounts, caps and epochs. `close_epoch` retries unfinished batches and does not expire or pay the
closing round until issuance is confirmed. `retry_recovery(batch_id)` is also permissionless.
`get_recovery_batches` is a bounded inspection view. Successful counts and lock accounting are
recorded once, on confirmation; failure does not erase debt or turn a recipient's lock into carry.

A retry lease permits recovery if a callback disappears. Attempt IDs reject stale callbacks.
Life mint retries use deterministic epoch/account IDs and verify immutable issuance terms without
restoring the original owner after a sale. Lock transfers have durable receiver receipts; duplicate
FT transfers are refunded, and the house checks the receipt after the FT resolver completes.
An explicit creation epoch preserves lock eligibility across delayed checkpoints. Backer lock
reservations use the same recovery queue. Receiver configuration cannot change while closing,
backing, pot callbacks or recovery batches are pending.

Backer Life minting itself retains the existing refund-on-reported-failure path; this queue covers
loss Lives and reward locks. A missing Backer Life callback is not recovered by the new retry method.

These storage changes require a fresh deployment for this prototype. There is no migration entry
point for an already initialized deployment. Do not deploy the new WASM over the ordinary demo.
Use the isolated launcher, which preserves the existing chain and runs fixed prices with no bots.
A permanently unavailable destination can still delay settlement; retries preserve the obligation,
not a guarantee of immediate availability.

## Three-minute walkthrough after setup

Disclose setup first: a local NEAR chain, funded test wallets, prepared seed/backer balances, mock
USDC/oracle/swap/vault/bridge and accelerated 45-second rounds. Building and deployment are outside
the walkthrough. Use `ONEUP_JUDGE_APP_PORT=3022 pnpm demo:judge` if 3021 is occupied.

1. **0:00–0:35:** show the recovery guide and selected wallet; explain an eligible loss must occur in
   a profitable house round. Show the prepared loss and its originating round.
2. **0:35–1:15:** open that Life; point out token ID, owner, expiry and the two distinct money figures.
   Leave its allocated test USDC unclaimed so the buyer can receive it.
3. **1:15–2:20:** enter an asking price, list that same Life with its unclaimed funds, switch to a second
   funded demo account, inspect the price and remaining rights, then buy it. Show its new owner, claim
   the allocated cash and confirm that the conditional cap does not increase.
4. **2:20–3:00:** switch back to the former owner. The detail view removes claim/sale controls.
   Explain that the contract also rejects a former-owner claim. Finish with the simulation label
   and the unvalidated demand and external-integration follow-ups.

The SDK `pnpm test:judge` test is separate from browser evidence. It asserts real local receipts,
including a rejected former-owner call, and records deployed hashes. Browser evidence must state
which actions were performed in the UI and which were asserted through the SDK.

## Follow-ups

Validate willingness to buy, recovery under real demand, liquidity and multi-wallet farming. Real
bridges, oracle deployment, Rhea lending/swap adapters and Chain Signatures remain future integrations.
The repository remains private with AGPL-3.0-only licensing; nothing here publishes or submits it.
