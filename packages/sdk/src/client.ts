// Typed access to the OneUp contracts. Views need only RPC; calls need an Account (near-api-js) or, in the
// browser, any signer passed as `send`.

import { Account, JsonRpcProvider, base64Encode, teraToGas } from "near-api-js";
import type { Deployment } from "./config.ts";
import type { Side } from "./maths.ts";
import type { CloseStep } from "./round.ts";

/** U128 / I128 values arrive as decimal strings. */
export type U128 = string;

export interface Market {
  id: string;
  feed_id: string;
  max_leverage: number;
  live: boolean;
  long_liability: U128;
  short_liability: U128;
  capacity_ppm: U128;
}

export interface Position {
  id: number;
  owner: string;
  market_id: string;
  side: Side;
  margin: U128;
  leverage: number;
  entry_price: U128;
  entry_publish_time: number;
  opened_at: number;
  cut_ppm: U128;
  close_order: number | null;
  triggers: Triggers;
  /** Block time the triggers were last set; only newer prices fire them. */
  triggers_set_at: number;
}

/** Take-profit and stop-loss prices, 1e8 units (decision D-19). */
export interface Triggers {
  take_profit: U128 | null;
  stop_loss: U128 | null;
}

export type OrderKind =
  /** `limit`: a resting limit order (D-30); null fills at the next price. */
  | { Open: { side: Side; margin: U128; leverage: number; cut_ppm: U128; triggers: Triggers; limit: U128 | null } }
  | { Close: { position_id: number; reason: "Close" | "Target" | "Stop" } };

export interface Order {
  id: number;
  owner: string;
  market_id: string;
  kind: OrderKind;
  placed_at: number;
}

export interface Solvency {
  pool: U128;
  liability: U128;
  reserve: U128;
  surplus: U128;
  seed: U128;
  both_sides: boolean;
  markets: { id: string; long_liability: U128; short_liability: U128; liability: U128; capacity: U128 }[];
}

export interface Epoch {
  net_losses: U128;
  fees: U128;
  id: number;
  started_at: number;
  losses: U128;
  payouts: U128;
  cuts: U128;
  markets: { market_id: string; losses: U128; payouts: U128; cuts: U128 }[];
}

export interface EpochSummary {
  epoch: number;
  started_at: number;
  ended_at: number;
  losses: U128;
  payouts: U128;
  cuts: U128;
  /** D-28: the marketplace's cut, part of `house_net`. */
  fees?: U128;
  house_net: U128;
  cap_ppm: U128;
  lives_minted: number;
  pool: U128;
  reserve: U128;
  surplus: U128;
  lives_pot: U128;
  buyback_pot: U128;
}

export interface Quote {
  allowed: boolean;
  reason: string | null;
  cut_ppm: U128;
  max_profit: U128;
  liquidation_price: U128 | null;
}

export interface LifeInfo {
  token_id: string;
  owner_id: string;
  epoch: number;
  face: U128;
  cap_ppm: U128;
  owed: U128;
  paid: U128;
  claimable: U128;
  full_heal: boolean;
  expired: boolean;
  /** A Backer Life: backed the house pool (D-22); never expires. */
  backer: boolean;
}

export interface Backing {
  /** Total seeded and backed so far, and the round's target (USDC units). */
  backed: U128;
  target: U128;
  open: boolean;
  min: U128;
  /** For the quoted amount: the cap (ppm) and what the Backer Life would be owed. */
  cap_ppm: U128;
  owed: U128;
  /** $1UP the quoted amount would be locked for its backer (D-26), and what's left of the allocation (1e18). */
  oneup: U128;
  oneup_left: U128;
}

/** The house's money at work (D-27). */
export interface Treasury {
  vault: string | null;
  /** Pool USDC in the vault, and the most that may be. */
  deployed: U128;
  deployable: U128;
  /** USDC from the vault's interest waiting to be drawn, and this period's tickets ($1 of net loss each, 1e6). */
  jackpot: U128;
  tickets: U128;
  /** The round whose close draws it. */
  draw_epoch: number;
}

export interface LockInfo {
  token_id: string;
  owner_id: string;
  amount: U128;
  created: number;
  /** First epoch with zero weight. */
  end: number;
  /** Made by the house from a loss, rather than locked by hand. */
  from_loss: boolean;
  /** Weight for the next epoch. */
  power: U128;
  /** What leaving now would cost. */
  exit_penalty: U128;
  exited: number | null;
  withdrawn: boolean;
  /** How many locks were merged into this one. */
  merged: number;
}

export interface EpochEmissions {
  epoch: number;
  scheduled: U128;
  released: U128;
  locked: U128;
  carry: U128;
}

/** A Sputnik DAO proposal (the fields the app uses). */
export interface DaoProposal {
  id: number;
  proposer: string;
  description: string;
  kind: Record<string, unknown>;
  status: "InProgress" | "Approved" | "Rejected" | "Removed" | "Expired" | "Moved" | "Failed";
  vote_counts: Record<string, [string, string, string]>;
  votes: Record<string, "Approve" | "Reject" | "Remove">;
  submission_time: string;
}

/** A DAO proposal that calls the house (the only kind OneUp's UI makes). */
export const houseProposal = (house: string, method_name: string, args: Record<string, unknown>) => ({
  FunctionCall: {
    receiver_id: house,
    actions: [{ method_name, args: base64Encode(new TextEncoder().encode(JSON.stringify(args))), deposit: "0", gas: "150000000000000" }],
  },
});

export interface Listing {
  nft_contract: string;
  token_id: string;
  seller: string;
  approval_id: number;
  /** USDC, 1e6. */
  price: U128;
  listed_at: number;
}

export interface OraclePrice {
  price: number;
  conf: number;
  expo: number;
  publish_time: number;
}

export interface CallArgs {
  contractId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas?: bigint;
  deposit?: bigint;
}

/** Sends a function call and returns its decoded result. */
export type Send = <T>(call: CallArgs) => Promise<T>;

const ONE_YOCTO = 1n;
/** 0.01 NEAR: storage for an NFT approval; the excess is refunded. */
const STORAGE_DEPOSIT = 10n ** 22n;
const MAX_GAS = teraToGas("300");

export function accountSender(account: Account): Send {
  return async <T>(c: CallArgs) =>
    (await account.callFunction({
      contractId: c.contractId,
      methodName: c.methodName,
      args: c.args,
      gas: c.gas ?? teraToGas("100"),
      deposit: c.deposit ?? 0n,
    })) as T;
}

export class OneUp {
  readonly provider: JsonRpcProvider;

  constructor(readonly d: Pick<Deployment, "network" | "rpcUrl" | "epochLengthS" | "contracts" | "markets">, provider?: JsonRpcProvider) {
    this.provider = provider ?? new JsonRpcProvider({ url: d.rpcUrl });
  }

  view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.provider.callFunction({ contractId, method, args }) as Promise<T>;
  }

  private house<T>(method: string, args: Record<string, unknown> = {}) {
    return this.view<T>(this.d.contracts.house, method, args);
  }

  // House views
  pool = () => this.house<U128>("get_pool");
  markets = () => this.house<Market[]>("get_markets");
  solvency = () => this.house<Solvency>("get_solvency");
  epoch = () => this.house<Epoch>("get_epoch");
  epochSummary = (epoch: number) => this.house<EpochSummary | null>("get_epoch_summary", { epoch });
  closing = () => this.house<{ epoch: number } | null>("get_closing");
  balance = (account_id: string) => this.house<U128>("get_balance", { account_id });
  positions = (account_id: string) => this.house<Position[]>("get_positions", { account_id });
  orders = (account_id: string) => this.house<Order[]>("get_orders", { account_id });
  listPositions = (from_index = 0, limit = 100) => this.house<Position[]>("list_positions", { from_index, limit });
  listOrders = (from_index = 0, limit = 100) => this.house<Order[]>("list_orders", { from_index, limit });
  pendingLife = (account_id: string) => this.house<U128>("get_pending_life", { account_id });
  buyback = (epoch: number) => this.house<{ status: "Pending" | "Swapping" | "Done" | { DeliveryPending: { remaining: U128 } } | { Delivering: { amount: U128 } }; usdc: U128; oneup: U128 } | null>("get_buyback", { epoch });
  emissions = (epoch: number) => this.house<EpochEmissions | null>("get_emissions", { epoch });
  emissionCarry = () => this.house<U128>("get_emission_carry");
  params = () =>
    this.house<{ life_expiry_epochs: number; market_capacity_ppm: U128; oneup_per_usdc: number; min_hold_s: number; fill_window_s: number; limit_expiry_s: number; leverage_hard_limit: number }>("get_params");
  quoteOpen = (market_id: string, side: Side, margin: bigint, leverage: number, price?: bigint) =>
    this.house<Quote>("quote_open", {
      market_id,
      side,
      margin: margin.toString(),
      leverage,
      price: price?.toString() ?? null,
    });

  // Other contracts
  price = (feedId: string) => this.view<OraclePrice | null>(this.d.contracts.oracle, "get_price_unsafe", { price_identifier: feedId });
  lives = (account_id: string) => this.view<LifeInfo[]>(this.d.contracts.life, "lives_for_owner", { account_id });
  locks = async (account_id: string): Promise<LockInfo[]> => {
    const locks: LockInfo[] = [];
    let from_index: U128 | null = "0";
    do {
      const page: { locks: LockInfo[]; next_index: U128 | null } = await this.view(this.d.contracts.ve, "locks_for_owner_page", { account_id, from_index, limit: 100 });
      locks.push(...page.locks);
      from_index = page.next_index;
    } while (from_index !== null);
    return locks;
  };
  lockInfo = (token_id: string) => this.view<LockInfo | null>(this.d.contracts.ve, "lock_info", { token_id });
  totalPower = (epoch: number) => this.view<U128>(this.d.contracts.ve, "get_total_power", { epoch });
  pendingPower = () => this.view<U128>(this.d.contracts.ve, "get_pending_power");
  lockRewards = (epoch: number) => this.view<U128>(this.d.contracts.ve, "get_rewards", { epoch });
  veClaimable = (token_id: string, epochs: number[]) => this.view<U128>(this.d.contracts.ve, "get_claimable", { token_id, epochs });
  veClaimables = async (token_ids: string[], epochs: number[]): Promise<Record<string, bigint>> => {
    const out: Record<string, bigint> = {};
    for (let i = 0; i < token_ids.length; i += 20) {
      const batch = await this.view<[string, U128][]>(this.d.contracts.ve, "get_claimable_many", { token_ids: token_ids.slice(i, i + 20), epochs });
      for (const [id, amount] of batch) out[id] = BigInt(amount);
    }
    return out;
  };
  lifeInfo = (token_id: string) => this.view<LifeInfo | null>(this.d.contracts.life, "life_info", { token_id });
  listings = async (): Promise<Listing[]> => {
    const all: Listing[] = [];
    for (;;) {
      const page = await this.view<Listing[]>(this.d.contracts.market, "get_listings", { from_index: all.length, limit: 100 });
      all.push(...page);
      if (page.length < 100) return all;
    }
  };
  /** $1UP out for `usdc_in` on the swap (Rhea's stand-in). */
  swapQuote = (usdc_in: bigint) => this.view<U128>(this.d.contracts.swap, "get_quote", { usdc_in: usdc_in.toString() });
  daoPolicy = () =>
    this.view<{ roles: { name: string; kind: { Group?: string[] } | string }[]; proposal_bond: string; proposal_period: string }>(
      this.d.contracts.dao!,
      "get_policy",
    );
  daoProposals = async (): Promise<DaoProposal[]> => {
    const last = await this.view<number>(this.d.contracts.dao!, "get_last_proposal_id");
    const from = Math.max(0, last - 20);
    return this.view<DaoProposal[]>(this.d.contracts.dao!, "get_proposals", { from_index: from, limit: 20 });
  };
  owner = () => this.house<[string, string | null]>("get_owner");
  /** The bootstrap round (D-22), with what backing `amount` now earns. */
  treasury = () => this.house<Treasury>("get_treasury");
  tickets = (account_id: string) => this.house<U128>("get_tickets", { account_id });
  /** The house's deposit in the vault: principal and interest accrued (D-27). */
  vaultDeposit = () =>
    this.d.contracts.vault
      ? this.view<{ principal: U128; interest: U128; updated: number }>(this.d.contracts.vault, "deposit_of", { account_id: this.d.contracts.house })
      : Promise.resolve(null);
  backing = (amount?: bigint) => this.house<Backing>("get_backing", { amount: amount?.toString() ?? null });
  usdcBalance = (account_id: string) => this.view<U128>(this.d.contracts.usdc, "ft_balance_of", { account_id });
  oneupBalance = (account_id: string) => this.view<U128>(this.d.contracts.oneup, "ft_balance_of", { account_id });

  // Calls. Each takes a `send` bound to the signer.
  calls(send: Send) {
    const c = this.d.contracts;
    const house = <T>(methodName: string, args: Record<string, unknown> = {}, gas?: bigint) =>
      send<T>({ contractId: c.house, methodName, args, gas });
    const ftCall = (token: string, receiver: string, amount: bigint, msg: string) =>
      send<U128>({
        contractId: token,
        methodName: "ft_transfer_call",
        args: { receiver_id: receiver, amount: amount.toString(), msg },
        gas: MAX_GAS,
        deposit: ONE_YOCTO,
      });
    return {
      faucet: (amount: bigint) => send<void>({ contractId: c.usdc, methodName: "faucet", args: { amount: amount.toString() } }),
      deposit: (amount: bigint) => ftCall(c.usdc, c.house, amount, ""),
      /** Deposits `amount` from the wallet and places an open for `margin` in one transaction. */
      /** `limit`: rest as a limit order at that price (1e8 units, D-30) instead of filling at the next price. */
      depositAndOpen: (amount: bigint, market_id: string, side: Side, margin: bigint, leverage: number, t: TriggerArgs = {}, limit?: bigint) =>
        ftCall(
          c.usdc,
          c.house,
          amount,
          JSON.stringify({ open: { market_id, side, margin: margin.toString(), leverage, ...triggerArgs(t), ...(limit ? { limit_price: limit.toString() } : {}) } }),
        ),
      withdraw: (amount: bigint) =>
        send<boolean>({ contractId: c.house, methodName: "withdraw", args: { amount: amount.toString() }, deposit: ONE_YOCTO }),
      placeOpen: (market_id: string, side: Side, margin: bigint, leverage: number, t: TriggerArgs = {}) =>
        house<number>("place_open", { market_id, side, margin: margin.toString(), leverage, ...triggerArgs(t) }),
      /** D-30: rests until the price reaches `limit` (1e8 units), then fills there. */
      placeLimitOpen: (market_id: string, side: Side, margin: bigint, leverage: number, limit: bigint, t: TriggerArgs = {}) =>
        house<number>("place_limit_open", { market_id, side, margin: margin.toString(), leverage, limit_price: limit.toString(), ...triggerArgs(t) }),
      /** D-30: takes a resting limit order down; its margin comes back. */
      cancelOrder: (order_id: number) => house<void>("cancel_order", { order_id }),
      /** Sets or clears a position's take-profit and stop-loss (1e8 price units; null clears). */
      setTriggers: (position_id: number, t: TriggerArgs) => house<void>("set_triggers", { position_id, ...triggerArgs(t) }),
      placeClose: (position_id: number) => house<number>("place_close", { position_id }),
      fill: (order_id: number) => house<boolean>("fill", { order_id }),
      expire: (order_id: number) => house<void>("expire", { order_id }),
      liquidate: (position_id: number) => house<boolean>("liquidate", { position_id }),
      takeProfit: (position_id: number) => house<boolean>("take_profit", { position_id }),
      /** A DAO proposal; `bond` comes from the DAO's policy. */
      propose: (description: string, kind: Record<string, unknown>, bond: bigint) =>
        send<number>({ contractId: c.dao!, methodName: "add_proposal", args: { proposal: { description, kind } }, deposit: bond }),
      /** Approve or reject; the kind is echoed back, as Sputnik requires, so a vote can't be swapped. */
      vote: (id: number, action: "VoteApprove" | "VoteReject", proposal: Record<string, unknown>) =>
        send<void>({ contractId: c.dao!, methodName: "act_proposal", args: { id, action, proposal }, gas: MAX_GAS }),
      hitTarget: (position_id: number) => house<boolean>("hit_target", { position_id }),
      hitStop: (position_id: number) => house<boolean>("hit_stop", { position_id }),
      /** One step of closing the finished round; repeat until "closed" (see CloseStep). */
      closeEpoch: (limit = 10) => house<CloseStep>("close_epoch", { limit }, MAX_GAS),
      buyback: (epoch: number, min_out: bigint) => house<void>("buyback", { epoch, min_out: min_out.toString() }, MAX_GAS),
      retryBuybackDelivery: (epoch: number) => house<void>("retry_buyback_delivery", { epoch }, MAX_GAS),
      /** At most 30 lives per call. */
      claimLives: (token_ids: string[]) =>
        send<void>({ contractId: c.life, methodName: "claim", args: { token_ids: token_ids.slice(0, 30) }, gas: MAX_GAS }),
      lock: (amount: bigint, epochs: number) => ftCall(c.oneup, c.ve, amount, JSON.stringify({ lock: { epochs } })),
      claimVe: (token_id: string, epochs: number[]) => send<void>({ contractId: c.ve, methodName: "claim", args: { token_id, epochs } }),
      claimVeMany: (token_ids: string[], epochs: number[]) =>
        send<void>({ contractId: c.ve, methodName: "claim_many", args: { token_ids, epochs }, gas: MAX_GAS }),
      mergeLocks: (token_ids: string[]) => send<string>({ contractId: c.ve, methodName: "merge", args: { token_ids }, gas: MAX_GAS }),
      unlock: (token_id: string) => send<void>({ contractId: c.ve, methodName: "unlock", args: { token_id } }),
      exitEarly: (token_id: string) => send<U128>({ contractId: c.ve, methodName: "exit_early", args: { token_id } }),
      /** Lists a Life NFT or a lock: `nft` is the life or ve contract, `price` in USDC units (1e6). */
      list: (nft: string, token_id: string, price: bigint) =>
        send<void>({
          contractId: nft,
          methodName: "nft_approve",
          args: { token_id, account_id: c.market, msg: JSON.stringify({ price: price.toString() }) },
          gas: MAX_GAS,
          deposit: STORAGE_DEPOSIT,
        }),
      delist: (nft: string, token_id: string) =>
        send<void>({ contractId: c.market, methodName: "delist", args: { nft_contract: nft, token_id } }),
      /** Buys the listing as the buyer saw it: a re-price or a new listing (after a claim, say) refunds the USDC. */
      buy: (l: Pick<Listing, "nft_contract" | "token_id" | "price" | "approval_id">) =>
        ftCall(c.usdc, c.market, BigInt(l.price), JSON.stringify({ buy: { nft_contract: l.nft_contract, token_id: l.token_id, price: String(l.price), approval_id: l.approval_id } })),
      /** Backs the house pool during the bootstrap round for a Backer Life (D-22). */
      back: (amount: bigint) => ftCall(c.usdc, c.house, amount, JSON.stringify({ back: {} })),
      /** D-27: the keeper puts pool USDC to work, brings it home, and brings the interest into the jackpot. */
      deployToVault: (amount: bigint) => house<void>("deploy", { amount: amount.toString() }, MAX_GAS),
      recall: (amount: bigint) => house<void>("recall", { amount: amount.toString() }, MAX_GAS),
      harvest: () => house<void>("harvest", {}, MAX_GAS),
      pushPrices: (updates: { feed_id: string; price: number; conf: number; expo: number; publish_time: number }[]) =>
        send<number>({ contractId: c.oracle, methodName: "push_prices", args: { updates } }),
    };
  }
}

/** Take-profit and stop-loss for an order or a position, 1e8 price units. */
export interface TriggerArgs {
  takeProfit?: bigint | null;
  stopLoss?: bigint | null;
}

const triggerArgs = (t: TriggerArgs) => ({
  take_profit: t.takeProfit ? t.takeProfit.toString() : null,
  stop_loss: t.stopLoss ? t.stopLoss.toString() : null,
});
