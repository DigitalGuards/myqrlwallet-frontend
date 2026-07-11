import type { NftStandard } from "@/utils/web3/nft";

// Re-resolve tokenURI + metadata JSON for a gallery entry when its last
// successful fetch is older than this. Mirrors the explorer backend's
// METADATA_REFRESH_TTL_MS default so both surfaces pick up on-chain
// tokenURI changes on the same cadence.
export const NFT_METADATA_TTL_MS = 24 * 60 * 60 * 1000;

export interface NFTInterface {
  contractAddress: string;
  standard: NftStandard;
  tokenId: string;
  collectionName?: string;
  collectionSymbol?: string;
  name?: string;
  description?: string;
  image?: string;
  // ERC-1155 holdings can be > 1 of the same id; stored as a decimal
  // string so it survives serialization. Undefined for ERC-721 (always 1).
  balance?: string;
  // Timestamp (ms) of the last SUCCESSFUL metadata fetch. Absent when
  // metadata has never resolved, which makes the entry eligible for a
  // refresh on the next gallery visit instead of waiting out the TTL.
  fetchedAt?: number;
}
