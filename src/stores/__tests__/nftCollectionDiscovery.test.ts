/** @jest-environment jsdom */
/**
 * Store-level behaviour of collection discovery: the picker groups the
 * explorer's per-token rows into collections, names the ones the
 * explorer indexes without metadata from on-chain name()/symbol(), and
 * adding a collection adds every owned token of that collection.
 */
import { configure } from "mobx";
import type { NFTInterface } from "@/constants";
import NftStore from "../nftStore";

const mockDiscoverNFTs = jest.fn();
const mockFetchCollectionNameSymbol = jest.fn();
const mockUpdateNftList = jest.fn();

jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { url: "https://rpc.example/testnet" } },
  NFT_METADATA_TTL_MS: 0,
}));
jest.mock("@/config/runtimeProfile", () => ({ IS_V3_PROFILE: false }));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({ deriveHexSeedAsync: jest.fn() }));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false, desktopSigner: {} }));
jest.mock("@/utils/nativeWalletMutation", () => ({ walletMutations: {} }));
jest.mock("@/utils/web3/contractFactory", () => ({ contractMethods: jest.fn() }));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    updateNftList: (...args: unknown[]) => mockUpdateNftList(...args),
    getNftList: jest.fn(async () => []),
    getHiddenNfts: jest.fn(async () => []),
    unhideNft: jest.fn(async () => undefined),
  },
}));
jest.mock("@/utils/web3", () => ({
  discoverNFTs: (...args: unknown[]) => mockDiscoverNFTs(...args),
  getQrlWeb3: jest.fn(),
}));
jest.mock("@/utils/web3/nft", () => {
  const actual = jest.requireActual("@/utils/web3/nft");
  return {
    ...actual,
    fetchCollectionNameSymbol: (...args: unknown[]) =>
      mockFetchCollectionNameSymbol(...args),
    fetchErc1155Balance: jest.fn(),
    fetchNftMetadata: jest.fn(),
    fetchTokenUri: jest.fn(),
    isErc721Owner: jest.fn(),
  };
});

const NAMELESS_1155 = `Q1222c5738d10574ec8ab9ee530f0f8e70817b687206e0989dc3f1a6c7722fa5715e3fa4750de7021880b7a14c328476f1f93aafb7b4d96135b5a5684210eb6cf`;
const DEVNET_PUNKS = `Qeb637802b80f5982ceb89dab30802437ac068c7b0f706fa8dff26df1021a18ff01e02f6661521caf64103891ec409ef707a3eb47be5c33e9a022a63d92d6356d`;
const HOLDER = `Qa73c065f7018cc0cfff98028d8ef1ff746f5cb425bc8840a4cdc2a6eb717faa121a2e959a6a0dac2d7c38252d70e4541397b0967880f00b9bd0c4c5d0fc46b2d`;

const discoveredRows: NFTInterface[] = [
  ...["2", "5", "6", "7", "8", "9", "10", "11"].map((tokenId, index) => ({
    contractAddress: NAMELESS_1155,
    standard: "ERC1155" as const,
    tokenId,
    balance: String(65 + index),
  })),
  ...Array.from({ length: 26 }, (_, index) => ({
    contractAddress: DEVNET_PUNKS,
    standard: "ERC721" as const,
    tokenId: String(index + 1),
    collectionName: "Devnet Punks",
    collectionSymbol: "DVP",
  })),
];

const makeStore = () => {
  const qrlStore = {
    qrlConnection: { blockchain: "TEST_NET" },
    activeAccount: { accountAddress: HOLDER },
  };
  return new NftStore(qrlStore as never, {} as never);
};


// noUncheckedIndexedAccess is on: narrow array reads without assertions.
const at = <T,>(items: T[], index: number): T => {
  const value = items[index];
  if (value === undefined) throw new Error(`no entry at index ${index}`);
  return value;
};

beforeEach(() => {
  configure({ enforceActions: "never" });
  mockDiscoverNFTs.mockReset().mockResolvedValue(discoveredRows);
  mockFetchCollectionNameSymbol.mockReset().mockResolvedValue({});
  mockUpdateNftList.mockReset().mockResolvedValue(undefined);
});

it("reports 2 collections for the 34 discovered tokens", async () => {
  const store = makeStore();
  await store.discoverNftsForReview(HOLDER);

  const collections = store.pendingDiscoveredNftCollections;
  expect(collections).toHaveLength(2);
  expect(collections.map((collection) => collection.tokenCount)).toEqual([
    8, 26,
  ]);
  expect(at(collections, 1).name).toBe("Devnet Punks");
  expect(at(collections, 1).symbol).toBe("DVP");
});

it("names an unnamed collection from on-chain name()/symbol()", async () => {
  mockFetchCollectionNameSymbol.mockResolvedValue({
    name: "Quantum Shards",
    symbol: "QSH",
  });
  const store = makeStore();
  await store.discoverNftsForReview(HOLDER);

  // Only the collection the explorer left unnamed costs an RPC read.
  expect(mockFetchCollectionNameSymbol).toHaveBeenCalledTimes(1);
  expect(mockFetchCollectionNameSymbol).toHaveBeenCalledWith(
    NAMELESS_1155,
    "https://rpc.example/testnet",
  );
  expect(at(store.pendingDiscoveredNftCollections, 0).name).toBe(
    "Quantum Shards",
  );
});

it("asks a nameless contract exactly once, then caches the empty answer", async () => {
  const store = makeStore();
  await store.discoverNftsForReview(HOLDER);
  await store.discoverNftsForReview(HOLDER);
  expect(mockFetchCollectionNameSymbol).toHaveBeenCalledTimes(1);
});

it("adds every owned token of a picked collection", async () => {
  const store = makeStore();
  await store.discoverNftsForReview(HOLDER);
  const punks = store.pendingDiscoveredNftCollections.filter(
    (collection) => collection.name === "Devnet Punks",
  );
  expect(punks).toHaveLength(1);

  await store.addDiscoveredCollections(punks);

  expect(store.nftList).toHaveLength(26);
  expect(
    store.nftList.every(
      (entry) => entry.contractAddress === DEVNET_PUNKS,
    ),
  ).toBe(true);
  expect(mockUpdateNftList).toHaveBeenCalledTimes(1);

  // The gallery now renders that collection, and the picker stops
  // offering it.
  expect(store.nftCollections).toHaveLength(1);
  expect(at(store.nftCollections, 0).tokenCount).toBe(26);
  expect(store.pendingDiscoveredNftCollections).toHaveLength(1);
  expect(at(store.pendingDiscoveredNftCollections, 0).tokenCount).toBe(8);
});

it("adds nothing when the picked collections carry no tokens", async () => {
  const store = makeStore();
  await store.addDiscoveredCollections([]);
  expect(mockUpdateNftList).not.toHaveBeenCalled();
});
