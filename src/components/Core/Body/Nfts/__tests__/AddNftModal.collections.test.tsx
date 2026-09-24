/** @jest-environment jsdom */
/**
 * The Add NFT dialog offers discovered collections, and adding one adds
 * every owned token of that collection.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NFTInterface } from "@/constants";
import {
  groupDiscoveredNftsByCollection,
  type NftCollectionGroup,
} from "@/utils/web3/nftCollections";
import { useStore } from "@/stores/store";
import { AddNftModal } from "../AddNftModal";

jest.mock("@/stores/store", () => ({ useStore: jest.fn() }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) =>
    values.filter((value) => typeof value === "string").join(" "),
  log: jest.fn(),
}));
jest.mock("@/config", () => ({ QRL_PROVIDER: { TEST_NET: { url: "" } } }));
jest.mock("@/utils/storage", () => ({
  StorageUtil: { getBlockChain: jest.fn(async () => "TEST_NET") },
}));
jest.mock("@/utils/web3", () => ({ isValidQrlAddress: () => false }));
jest.mock("@/utils/web3/nft", () => ({
  detectTokenStandard: jest.fn(),
  fetchNftCollectionInfo: jest.fn(),
  fetchNftMetadata: jest.fn(),
  fetchOwned721Ids: jest.fn(),
  fetchErc1155Balance: jest.fn(),
  fetchTokenUri: jest.fn(),
  isErc721Owner: jest.fn(),
}));

const NAMELESS_1155 = `Q1222c5738d10574ec8ab9ee530f0f8e70817b687206e0989dc3f1a6c7722fa5715e3fa4750de7021880b7a14c328476f1f93aafb7b4d96135b5a5684210eb6cf`;
const DEVNET_PUNKS = `Qeb637802b80f5982ceb89dab30802437ac068c7b0f706fa8dff26df1021a18ff01e02f6661521caf64103891ec409ef707a3eb47be5c33e9a022a63d92d6356d`;
const HOLDER = `Qa73c065f7018cc0cfff98028d8ef1ff746f5cb425bc8840a4cdc2a6eb717faa121a2e959a6a0dac2d7c38252d70e4541397b0967880f00b9bd0c4c5d0fc46b2d`;

const discovered: NFTInterface[] = [
  ...["2", "5", "6", "7", "8", "9", "10", "11"].map((tokenId) => ({
    contractAddress: NAMELESS_1155,
    standard: "ERC1155" as const,
    tokenId,
    balance: "65",
  })),
  ...Array.from({ length: 26 }, (_, index) => ({
    contractAddress: DEVNET_PUNKS,
    standard: "ERC721" as const,
    tokenId: String(index + 1),
    collectionName: "Devnet Punks",
    collectionSymbol: "DVP",
  })),
];

const addDiscoveredCollections = jest.fn(
  async (_collections: NftCollectionGroup[]) => undefined,
);

const mount = () => {
  (useStore as jest.Mock).mockReturnValue({
    qrlStore: { activeAccount: { accountAddress: HOLDER } },
    nftStore: {
      pendingDiscoveredNftCollections:
        groupDiscoveredNftsByCollection(discovered),
      discoverNftsForReview: jest.fn(async () => []),
      addDiscoveredCollections,
    },
  });
  return render(<AddNftModal isOpen onClose={jest.fn()} />);
};


// noUncheckedIndexedAccess is on: narrow array reads without assertions.
const at = <T,>(items: T[], index: number): T => {
  const value = items[index];
  if (value === undefined) throw new Error(`no entry at index ${index}`);
  return value;
};

beforeEach(() => addDiscoveredCollections.mockClear());
afterEach(cleanup);

it("lists discovered collections instead of one row per token", () => {
  mount();
  expect(screen.getByText("Discovered NFT collections (2)")).toBeTruthy();
  expect(screen.getByText(/26 items · ERC-721 · Qeb63780/)).toBeTruthy();
  expect(screen.getByText(/8 items · ERC-1155 · Q1222c573/)).toBeTruthy();
  expect(screen.queryByText(/Unknown collection/)).toBeNull();
});

it("adds every owned token of the picked collection", async () => {
  mount();
  fireEvent.click(screen.getByLabelText(/Devnet Punks/));
  fireEvent.click(screen.getByText("Add Selected (1)"));

  await screen.findByText("Discovered NFT collections (2)");
  expect(addDiscoveredCollections).toHaveBeenCalledTimes(1);
  const [picks] = at(addDiscoveredCollections.mock.calls, 0);
  expect(picks).toHaveLength(1);
  expect(at(picks, 0).key).toBe(DEVNET_PUNKS.toLowerCase());
  expect(at(picks, 0).tokens).toHaveLength(26);
});
