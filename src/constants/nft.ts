import type { NftStandard } from "@/utils/web3/nft";

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
  // Snapshot of when we last fetched metadata, for cache-warming UI.
  fetchedAt?: number;
}
