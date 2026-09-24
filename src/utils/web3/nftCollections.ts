import type { NFTInterface } from "@/constants";
import { formatAddressFingerprint } from "@/utils/formatting";
import type { NftStandard } from "./nft";

/**
 * Collection-level grouping for NFTs, ported from the MyQRLWallet
 * browser extension (src/services/assetDiscovery.ts:
 * discoverNftCollections / discoverOwnedNftTokens). The explorer returns
 * one row per (contract, tokenID); both clients group those rows by
 * contract so the wallet talks in collections and keeps the individual
 * tokens one level down.
 *
 * Pure functions only: no network, no store access, so the grouping is
 * unit-testable against a trimmed explorer fixture.
 */

/**
 * Upper bound on token ids carried per discovered collection. Adding a
 * collection costs one on-chain ownership re-check per token, so an
 * unbounded (or hostile) explorer response must not be able to drive an
 * unbounded RPC loop. Mirrors the extension's
 * MAX_DISCOVERED_TOKEN_IDS.
 */
export const MAX_DISCOVERED_TOKENS_PER_COLLECTION = 50;

export interface NftCollectionGroup {
  /** Contract address as first seen, casing preserved. */
  contractAddress: string;
  /** Lowercased contract address: the grouping and selection key. */
  key: string;
  standard: NftStandard;
  name?: string;
  symbol?: string;
  /** Distinct owned token ids in this collection, before any cap. */
  tokenCount: number;
  /** Owned tokens, capped by maxTokensPerCollection. */
  tokens: NFTInterface[];
  /** True when tokenCount exceeded the cap and tokens was trimmed. */
  truncated: boolean;
}

export interface CollectionNameOverride {
  name?: string;
  symbol?: string;
}

export interface GroupNftsOptions {
  /** Cap on tokens carried per group. Defaults to no cap. */
  maxTokensPerCollection?: number;
  /**
   * Name/symbol resolved on chain, keyed by lowercased contract address.
   * Used when the explorer index carries no collection metadata.
   */
  overrides?: Record<string, CollectionNameOverride>;
}

/**
 * Groups per-token rows into collections. Rows are deduped on
 * (contract, tokenId), because the explorer can return the same token
 * twice, and the item count has to match what the gallery renders.
 * Insertion order is preserved so the list is stable across refreshes.
 */
export function groupNftsByCollection(
  nfts: NFTInterface[],
  options: GroupNftsOptions = {},
): NftCollectionGroup[] {
  const maxTokens =
    options.maxTokensPerCollection ?? Number.POSITIVE_INFINITY;
  const overrides = options.overrides ?? {};

  const groups = new Map<string, NftCollectionGroup>();
  const seenTokens = new Set<string>();

  for (const nft of nfts) {
    if (!nft.contractAddress || !nft.tokenId) continue;
    const key = nft.contractAddress.toLowerCase();
    const tokenKey = `${key}:${nft.tokenId}`;
    if (seenTokens.has(tokenKey)) continue;
    seenTokens.add(tokenKey);

    const existing = groups.get(key);
    if (existing) {
      existing.tokenCount += 1;
      if (!existing.name && nft.collectionName) existing.name = nft.collectionName;
      if (!existing.symbol && nft.collectionSymbol) {
        existing.symbol = nft.collectionSymbol;
      }
      if (existing.tokens.length < maxTokens) existing.tokens.push(nft);
      else existing.truncated = true;
      continue;
    }

    groups.set(key, {
      contractAddress: nft.contractAddress,
      key,
      standard: nft.standard,
      name: nft.collectionName || undefined,
      symbol: nft.collectionSymbol || undefined,
      tokenCount: 1,
      tokens: maxTokens >= 1 ? [nft] : [],
      truncated: maxTokens < 1,
    });
  }

  // On-chain name()/symbol() results win only where the explorer index
  // had nothing, so an indexed name is never overwritten by a slower
  // RPC read.
  for (const group of groups.values()) {
    const override = overrides[group.key];
    if (!override) continue;
    if (!group.name && override.name) group.name = override.name;
    if (!group.symbol && override.symbol) group.symbol = override.symbol;
  }

  return [...groups.values()];
}

/** Convenience wrapper applying the discovery cap. */
export function groupDiscoveredNftsByCollection(
  nfts: NFTInterface[],
  overrides?: Record<string, CollectionNameOverride>,
): NftCollectionGroup[] {
  return groupNftsByCollection(nfts, {
    maxTokensPerCollection: MAX_DISCOVERED_TOKENS_PER_COLLECTION,
    overrides,
  });
}

/**
 * Display title for a collection row. ERC-1155 contracts routinely omit
 * name() and symbol(), and the explorer then indexes neither, so fall
 * back to a shortened contract address instead of leaving the row blank.
 */
export function collectionDisplayName(group: NftCollectionGroup): string {
  return (
    group.name || group.symbol || formatAddressFingerprint(group.contractAddress)
  );
}

/** Human label for the token standard, hyphenated as the explorer writes it. */
export function collectionStandardLabel(standard: NftStandard): string {
  return standard === "ERC1155" ? "ERC-1155" : "ERC-721";
}

/** Collections whose name and symbol are both unknown after grouping. */
export function collectionsMissingNames(
  groups: NftCollectionGroup[],
): NftCollectionGroup[] {
  return groups.filter((group) => !group.name && !group.symbol);
}
