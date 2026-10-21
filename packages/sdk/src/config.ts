// Where everything is deployed. `pnpm localnet` writes localnet.json in this shape.

export interface MarketConfig {
  id: string;
  /** Pyth feed id, hex without 0x. */
  feedId: string;
  /** Starting price for simulated feeds, in USD. */
  simPrice: number;
}

export interface Deployment {
  network: "localnet";
  rpcUrl: string;
  epochLengthS: number;
  contracts: {
    house: string;
    life: string;
    oneup: string;
    ve: string;
    usdc: string;
    oracle: string;
    swap: string;
    market: string;
  };
  /** Dev keys. Localnet only: one throwaway key for every account it creates. */
  owner: { id: string; key: string };
  keeper: { id: string; key: string };
  bots: { id: string; key: string }[];
  demo: { id: string; key: string };
  markets: MarketConfig[];
}

export const MARKETS: MarketConfig[] = [
  { id: "NEAR-USD", feedId: "c415de8d2efa7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750", simPrice: 2.5 },
  { id: "BTC-USD", feedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", simPrice: 110_000 },
  { id: "ETH-USD", feedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", simPrice: 4_000 },
];
