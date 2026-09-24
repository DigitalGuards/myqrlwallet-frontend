/**
 * Pure helpers behind the NFT back-navigation: the collection URL and
 * the history-state flags that decide whether Back pops an entry or
 * navigates to a fallback.
 */
import {
  NFT_COLLECTION_PARAM,
  collectionSearch,
  nftCollectionPath,
  nftDetailPath,
  openedFromCollectionList,
  openedFromCollectionView,
} from "../nftNavigation";

const CONTRACT = `QAB${"c".repeat(125)}`;

describe("nftNavigation", () => {
  it("addresses a collection by lowercased contract on the home page", () => {
    expect(collectionSearch(CONTRACT)).toBe(
      `?${NFT_COLLECTION_PARAM}=${CONTRACT.toLowerCase()}`,
    );
    expect(nftCollectionPath("/", CONTRACT)).toBe(
      `/?${NFT_COLLECTION_PARAM}=${CONTRACT.toLowerCase()}`,
    );
  });

  it("falls back to the plain home page without a contract address", () => {
    expect(nftCollectionPath("/", "")).toBe("/");
  });

  it("fills the detail route pattern", () => {
    expect(nftDetailPath("/nft/:contractAddress/:tokenId", CONTRACT, "7")).toBe(
      `/nft/${CONTRACT}/7`,
    );
  });

  it("reads the history-state flags without trusting their shape", () => {
    expect(openedFromCollectionList({ nftCollectionFromList: true })).toBe(true);
    expect(openedFromCollectionList({ nftCollectionFromList: "yes" })).toBe(
      false,
    );
    expect(openedFromCollectionList(null)).toBe(false);
    expect(openedFromCollectionList("collection")).toBe(false);

    expect(openedFromCollectionView({ nftDetailFromCollection: true })).toBe(
      true,
    );
    expect(openedFromCollectionView({ nftCollectionFromList: true })).toBe(
      false,
    );
    expect(openedFromCollectionView(undefined)).toBe(false);
  });
});
