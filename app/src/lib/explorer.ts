// Links into NearBlocks, the NEAR explorer, once OneUp runs on a network it indexes. On localnet there is no
// explorer, so every helper returns null and callers show plain text. URL shapes as NearBlocks uses them
// (checked on nearblocks.io and testnet.nearblocks.io, 23 Oct 2026).

import type { Deployment } from "@oneup/sdk";

const BASE: Record<Deployment["network"], string | null> = {
  mainnet: "https://nearblocks.io",
  testnet: "https://testnet.nearblocks.io",
  localnet: null,
};

export function explorer(network: Deployment["network"]) {
  const base = BASE[network];
  const at = (path: string) => (base ? `${base}${path}` : null);
  return {
    tx: (hash: string) => at(`/txns/${hash}`),
    account: (id: string) => at(`/address/${id}`),
    block: (hash: string) => at(`/blocks/${hash}`),
    /** An NFT collection (Life NFTs, locks): its transfers. */
    nfts: (contract: string) => at(`/nft-tokens/${contract}`),
    nft: (contract: string, tokenId: string) => at(`/nft-tokens/${contract}/tokens/${encodeURIComponent(tokenId)}`),
  };
}
