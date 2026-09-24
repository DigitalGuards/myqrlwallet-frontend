/**
 * Navigation helpers shared by the NFT gallery, the collection rows, and
 * the NFT detail page.
 *
 * The gallery drills from a collection list into one collection. That
 * drill-down has to survive a navigation to an NFT detail page and back,
 * so the open collection lives in the URL (`/?collection=<contract>`)
 * instead of component state, and every hop pushes one history entry.
 * Back buttons then pop that entry, which keeps the in-app Back button
 * and the browser Back button in step.
 *
 * Pure string/state helpers only, so they unit-test without a router and
 * without importing the router module (which builds a browser router at
 * import time).
 */

/** Query parameter carrying the lowercased contract of the open collection. */
export const NFT_COLLECTION_PARAM = "collection";

/** History state flags recorded on the entries the NFT views push. */
export interface NftNavState {
  /** Set on a collection view opened from the collection list. */
  nftCollectionFromList?: boolean;
  /** Set on an NFT detail page opened from its collection view. */
  nftDetailFromCollection?: boolean;
}

function readFlag(state: unknown, key: keyof NftNavState): boolean {
  if (typeof state !== "object" || state === null) return false;
  return (state as Record<string, unknown>)[key] === true;
}

/** True when the previous history entry is the collection list. */
export function openedFromCollectionList(state: unknown): boolean {
  return readFlag(state, "nftCollectionFromList");
}

/** True when the previous history entry is this NFT's collection view. */
export function openedFromCollectionView(state: unknown): boolean {
  return readFlag(state, "nftDetailFromCollection");
}

/** Search string that opens one collection's drill-down on the home page. */
export function collectionSearch(contractAddress: string): string {
  const params = new URLSearchParams();
  params.set(NFT_COLLECTION_PARAM, contractAddress.toLowerCase());
  return `?${params.toString()}`;
}

/**
 * Home page with one collection open. Falls back to the plain home page
 * when the contract address is unknown, so a malformed deep link still
 * lands somewhere useful.
 */
export function nftCollectionPath(
  homePath: string,
  contractAddress: string,
): string {
  if (!contractAddress) return homePath;
  return `${homePath}${collectionSearch(contractAddress)}`;
}

/** Detail page path for one token, from the parameterised route pattern. */
export function nftDetailPath(
  detailRoute: string,
  contractAddress: string,
  tokenId: string,
): string {
  return detailRoute
    .replace(":contractAddress", contractAddress)
    .replace(":tokenId", tokenId);
}
