// Typed access to the OneUp contracts. Views need only RPC; calls need an Account (near-api-js) or, in the
// browser, any signer passed as `send`.

import { Account, JsonRpcProvider, teraToGas } from "near-api-js";
import type { Deployment } from "./config.ts";
import type { Side } from "./maths.ts";

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
}

export type OrderKind =
  | { Open: { side: Side; margin: U128; leverage: number; cut_ppm: U128 } }
  | { Close: { position_id: number } };

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
}

export interface LockInfo {
  token_id: string;
  owner_id: string;
  amount: U128;
  created: number;
  end: number;
  power: U128;
  votes: [string, U128][];
  withdrawn: boolean;
}

export interface Proposal {
  market_id: string;
  feed_id: string;
  proposer: string;
  created: number;
  idle: number;
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

  constructor(readonly d: Deployment, provider?: JsonRpcProvider) {
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
  closing = () => this.house<unknown | null>("get_closing");
  balance = (account_id: string) => this.house<U128>("get_balance", { account_id });
  positions = (account_id: string) => this.house<Position[]>("get_positions", { account_id });
  orders = (account_id: string) => this.house<Order[]>("get_orders", { account_id });
  listPositions = (from_index = 0, limit = 100) => this.house<Position[]>("list_positions", { from_index, limit });
  listOrders = (from_index = 0, limit = 100) => this.house<Order[]>("list_orders", { from_index, limit });
  pendingLife = (account_id: string) => this.house<U128>("get_pending_life", { account_id });
  voteShares = () => this.house<[string, U128][]>("get_vote_shares");
  buyback = (epoch: number) => this.house<{ status: string; usdc: U128; oneup: U128 } | null>("get_buyback", { epoch });
  claimableEmissions = (account_id: string, epochs: number[]) =>
    this.house<U128>("get_claimable_emissions", { account_id, epochs });
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
  locks = (account_id: string) => this.view<LockInfo[]>(this.d.contracts.ve, "locks_for_owner", { account_id });
  votes = (epoch: number) => this.view<[string, U128][]>(this.d.contracts.ve, "get_votes", { epoch });
  pendingVotes = () => this.view<[string, U128][]>(this.d.contracts.ve, "get_pending_votes");
  proposals = () => this.view<Proposal[]>(this.d.contracts.ve, "get_proposals");
  veClaimable = (token_id: string, epochs: number[]) =>
    this.view<[string, U128][]>(this.d.contracts.ve, "get_claimable", { token_id, epochs });
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
      withdraw: (amount: bigint) =>
        send<boolean>({ contractId: c.house, methodName: "withdraw", args: { amount: amount.toString() }, deposit: ONE_YOCTO }),
      placeOpen: (market_id: string, side: Side, margin: bigint, leverage: number) =>
        house<number>("place_open", { market_id, side, margin: margin.toString(), leverage }),
      placeClose: (position_id: number) => house<number>("place_close", { position_id }),
      fill: (order_id: number) => house<boolean>("fill", { order_id }),
      expire: (order_id: number) => house<void>("expire", { order_id }),
      liquidate: (position_id: number) => house<boolean>("liquidate", { position_id }),
      takeProfit: (position_id: number) => house<boolean>("take_profit", { position_id }),
      closeEpoch: (limit = 20) => house<string>("close_epoch", { limit }, MAX_GAS),
      buyback: (epoch: number, min_out: bigint) => house<void>("buyback", { epoch, min_out: min_out.toString() }, MAX_GAS),
      claimEmissions: (epochs: number[]) => house<void>("claim_emissions", { epochs }),
      claimLives: (token_ids: string[]) => send<void>({ contractId: c.life, methodName: "claim", args: { token_ids } }),
      lock: (amount: bigint, epochs: number) => ftCall(c.oneup, c.ve, amount, JSON.stringify({ lock: { epochs } })),
      vote: (token_id: string, allocations: [string, bigint][]) =>
        send<void>({
          contractId: c.ve,
          methodName: "vote",
          args: { token_id, allocations: allocations.map(([m, a]) => [m, a.toString()]) },
        }),
      claimVe: (token_id: string, epochs: number[]) => send<void>({ contractId: c.ve, methodName: "claim", args: { token_id, epochs } }),
      bribe: (token: string, market_id: string, amount: bigint) =>
        ftCall(token, c.ve, amount, JSON.stringify({ bribe: { market_id } })),
      propose: (market_id: string, feed_id: string) =>
        ftCall(c.usdc, c.ve, 500n * 1_000_000n, JSON.stringify({ propose: { market_id, feed_id } })),
      pushPrices: (updates: { feed_id: string; price: number; conf: number; expo: number; publish_time: number }[]) =>
        send<number>({ contractId: c.oracle, methodName: "push_prices", args: { updates } }),
    };
  }
}
