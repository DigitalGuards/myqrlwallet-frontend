/**
 * Collection grouping for explorer-discovered NFTs.
 *
 * The fixture is trimmed from the live zondscan response for a real
 * testnet address (34 rows: 8 ERC-1155 tokens on a contract the explorer
 * indexes with no collection metadata, and 26 ERC-721 "Devnet Punks"
 * tokens), so the counts asserted here are the counts the wallet has to
 * render.
 */
import { discoverNFTs } from "../nftDiscovery";
import {
  MAX_DISCOVERED_TOKENS_PER_COLLECTION,
  collectionDisplayName,
  collectionStandardLabel,
  collectionsMissingNames,
  groupDiscoveredNftsByCollection,
  groupNftsByCollection,
} from "../nftCollections";
import type { NFTInterface } from "@/constants";

jest.mock("@/config", () => ({
  getNFTDiscoveryApiUrl: (address: string) =>
    `https://explorer.example/api/address/${address}/nfts`,
  SERVER_URL: "https://wallet.example/api",
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));

const NAMELESS_1155 = `Q1222c5738d10574ec8ab9ee530f0f8e70817b687206e0989dc3f1a6c7722fa5715e3fa4750de7021880b7a14c328476f1f93aafb7b4d96135b5a5684210eb6cf`;
const DEVNET_PUNKS = `Qeb637802b80f5982ceb89dab30802437ac068c7b0f706fa8dff26df1021a18ff01e02f6661521caf64103891ec409ef707a3eb47be5c33e9a022a63d92d6356d`;
const HOLDER = `Qa73c065f7018cc0cfff98028d8ef1ff746f5cb425bc8840a4cdc2a6eb717faa121a2e959a6a0dac2d7c38252d70e4541397b0967880f00b9bd0c4c5d0fc46b2d`;

type ExplorerRow = Record<string, unknown>;

const erc1155Row = (tokenID: string, balance: string): ExplorerRow => ({
  contractAddress: NAMELESS_1155,
  holderAddress: HOLDER,
  tokenID,
  tokenStandard: "ERC-1155",
  balance,
});

const punkRow = (tokenID: string): ExplorerRow => ({
  contractAddress: DEVNET_PUNKS,
  holderAddress: HOLDER,
  tokenID,
  tokenStandard: "ERC-721",
  balance: "1",
  collectionName: "Devnet Punks",
  collectionSymbol: "DVP",
});

// 8 + 26 = the 34 rows the explorer returns for this address.
const explorerRows: ExplorerRow[] = [
  ...["2", "5", "6", "7", "8", "9", "10", "11"].map((id, index) =>
    erc1155Row(id, String(65 + index)),
  ),
  ...Array.from({ length: 26 }, (_, index) => punkRow(String(index + 1))),
];

const mockExplorer = (rows: ExplorerRow[]) => {
  const fetchStub = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ address: HOLDER, nfts: rows, count: rows.length }),
  }));
  (globalThis as { fetch?: unknown }).fetch = fetchStub;
};

const nft = (overrides: Partial<NFTInterface>): NFTInterface => ({
  contractAddress: DEVNET_PUNKS,
  standard: "ERC721",
  tokenId: "1",
  ...overrides,
});


// noUncheckedIndexedAccess is on: narrow array reads without assertions.
const at = <T,>(items: T[], index: number): T => {
  const value = items[index];
  if (value === undefined) throw new Error(`no entry at index ${index}`);
  return value;
};

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as { fetch?: unknown }).fetch;
});

it("groups the 34 discovered tokens into 2 collections with their real counts", async () => {
  mockExplorer(explorerRows);
  const discovered = await discoverNFTs(HOLDER, "TEST_NET");
  expect(discovered).toHaveLength(34);

  const collections = groupDiscoveredNftsByCollection(discovered);
  expect(collections).toHaveLength(2);

  const nameless = at(collections, 0);
  const punks = at(collections, 1);
  expect(nameless.tokenCount).toBe(8);
  expect(nameless.standard).toBe("ERC1155");
  expect(nameless.name).toBeUndefined();
  expect(nameless.symbol).toBeUndefined();
  expect(punks.tokenCount).toBe(26);
  expect(punks.standard).toBe("ERC721");
  expect(punks.name).toBe("Devnet Punks");
  expect(punks.symbol).toBe("DVP");
  expect(punks.tokens).toHaveLength(26);
  expect(punks.truncated).toBe(false);
});

it("keeps the explorer collection name so a named collection never reads as unknown", () => {
  const collections = groupNftsByCollection([
    nft({ tokenId: "2", collectionName: "Devnet Punks", collectionSymbol: "DVP" }),
    // Later rows of the same collection may arrive without metadata.
    nft({ tokenId: "13" }),
  ]);
  expect(collections).toHaveLength(1);
  expect(collectionDisplayName(at(collections, 0))).toBe("Devnet Punks");
  expect(at(collections, 0).tokenCount).toBe(2);
});

it("falls back to the shortened contract address when nothing names the collection", () => {
  const collection = at(
    groupNftsByCollection([
      nft({ contractAddress: NAMELESS_1155, standard: "ERC1155", tokenId: "2" }),
    ]),
    0,
  );
  expect(collectionsMissingNames([collection])).toHaveLength(1);
  const display = collectionDisplayName(collection);
  expect(display).not.toBe("");
  expect(display).toContain("...");
  expect(display.startsWith("Q1222c573")).toBe(true);
  expect(collectionStandardLabel(collection.standard)).toBe("ERC-1155");
});

it("applies an on-chain name()/symbol() override only where the explorer had none", () => {
  const collections = groupNftsByCollection(
    [
      nft({ contractAddress: NAMELESS_1155, standard: "ERC1155", tokenId: "2" }),
      nft({ tokenId: "3", collectionName: "Devnet Punks", collectionSymbol: "DVP" }),
    ],
    {
      overrides: {
        [NAMELESS_1155.toLowerCase()]: { name: "Quantum Shards", symbol: "QSH" },
        [DEVNET_PUNKS.toLowerCase()]: { name: "Stale Name", symbol: "OLD" },
      },
    },
  );
  expect(collectionDisplayName(at(collections, 0))).toBe("Quantum Shards");
  expect(at(collections, 0).symbol).toBe("QSH");
  expect(collectionDisplayName(at(collections, 1))).toBe("Devnet Punks");
  expect(at(collections, 1).symbol).toBe("DVP");
});

it("counts duplicate explorer rows once", () => {
  const collection = at(
    groupNftsByCollection([
      nft({ tokenId: "7" }),
      nft({ tokenId: "7" }),
      nft({ tokenId: "8" }),
    ]),
    0,
  );
  expect(collection.tokenCount).toBe(2);
  expect(collection.tokens).toHaveLength(2);
});

it("skips rows with no contract address or no token id", () => {
  const collections = groupNftsByCollection([
    nft({ contractAddress: "", tokenId: "1" }),
    nft({ tokenId: "" }),
    nft({ tokenId: "4" }),
  ]);
  expect(collections).toHaveLength(1);
  expect(at(collections, 0).tokenCount).toBe(1);
});

it("caps the tokens carried per discovered collection while reporting the true count", () => {
  const rows = Array.from({ length: 120 }, (_, index) =>
    nft({ tokenId: String(index) }),
  );
  const collection = at(groupDiscoveredNftsByCollection(rows), 0);
  expect(collection.tokenCount).toBe(120);
  expect(collection.tokens).toHaveLength(MAX_DISCOVERED_TOKENS_PER_COLLECTION);
  expect(collection.truncated).toBe(true);
});

it("preserves first-seen order across collections", () => {
  mockExplorer([punkRow("1"), erc1155Row("2", "65"), punkRow("2")]);
  const collections = groupNftsByCollection([
    nft({ tokenId: "1" }),
    nft({ contractAddress: NAMELESS_1155, standard: "ERC1155", tokenId: "2" }),
    nft({ tokenId: "2" }),
  ]);
  expect(collections.map((collection) => collection.key)).toEqual([
    DEVNET_PUNKS.toLowerCase(),
    NAMELESS_1155.toLowerCase(),
  ]);
});
