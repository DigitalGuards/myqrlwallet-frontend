// Re-resolve tokenURI + metadata JSON for a gallery entry when its last
// successful fetch is older than this. Mirrors the explorer backend's
// METADATA_REFRESH_TTL_MS default so both surfaces pick up on-chain
// tokenURI changes on the same cadence.
export const NFT_METADATA_TTL_MS = 24 * 60 * 60 * 1000;

// Failure backoff for metadata refreshes: after N consecutive failures a
// non-forced refresh waits base * 2^(N-1), capped at max, before retrying.
// Without this a permanently dead tokenURI would re-fetch on every gallery
// mount forever. The gallery Refresh button bypasses the backoff.
export const NFT_METADATA_RETRY_BASE_MS = 5 * 60 * 1000;
export const NFT_METADATA_RETRY_MAX_MS = 24 * 60 * 60 * 1000;

// Cap on metadata fetches per refresh run. Each eligible entry costs one
// tokenURI RPC plus one /api/ipfs proxy fetch, and the proxy rate-limits
// 60 req/min/IP shared with the gallery's own thumbnail loads; a large
// gallery drains the rest of its backlog on subsequent visits.
export const NFT_METADATA_MAX_PER_RUN = 12;

export interface NFTInterface {
  contractAddress?: unknown;
  standard?: unknown;
  tokenId?: unknown;
  collectionName?: unknown;
  collectionSymbol?: unknown;
  name?: unknown;
  description?: unknown;
  image?: unknown;
  // ERC-1155 holdings can be > 1 of the same id; stored as a decimal
  // string so it survives serialization. Undefined for ERC-721 (always 1).
  balance?: unknown;
  // Timestamp (ms) of the last SUCCESSFUL metadata fetch. Absent when
  // metadata has never resolved, which makes the entry eligible for a
  // refresh on the next gallery visit instead of waiting out the TTL.
  fetchedAt?: unknown;
  // Failure bookkeeping for metadata refreshes: consecutive failure count
  // and the timestamp of the last failure. Drive the exponential backoff
  // in nftStore.refreshNftMetadata; cleared on success.
  fetchRetryCount?: unknown;
  fetchFailedAt?: unknown;
}

/** Narrow only the receiver of an existing NFT property read. */
export function nftValue(value: unknown): NFTInterface {
  if (!isNftValue(value)) throw new TypeError('Cannot read properties of null or undefined');
  return value;
}

function isNftValue(value: unknown): value is NFTInterface {
  return value !== null && value !== undefined;
}
