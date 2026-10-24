/** @jest-environment jsdom */
/**
 * The Add NFT dialog offers discovered collections, and adding one adds
 * every owned token of that collection.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NFTInterface } from "@/constants";
import {
  groupDiscoveredNftsByCollection,
  type NftCollectionGroup,
} from "@/utils/web3/nftCollections";
import { reportError } from "@/utils/reportError";
import { isValidQrlAddress } from "@/utils/web3";
import { detectTokenStandard, fetchNftCollectionInfo, type NftCollectionInfo } from "@/utils/web3/nft";
import { AddNftModal } from "../AddNftModal";

const mockUseStore = jest.fn<unknown, []>();
jest.mock("@/stores/store", () => ({ useStore: () => mockUseStore() }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) =>
    values.filter((value) => typeof value === "string").join(" "),
  log: jest.fn(),
}));
jest.mock("@/config", () => ({ QRL_PROVIDER: { TEST_NET: { url: "" } } }));
jest.mock("@/utils/storage", () => ({
  StorageUtil: { getBlockChain: jest.fn(() => Promise.resolve("TEST_NET")) },
}));
jest.mock("@/utils/reportError", () => ({ reportError: jest.fn() }));
jest.mock("@/utils/web3", () => ({ isValidQrlAddress: jest.fn(() => false) }));
jest.mock("@/utils/web3/nft", () => ({
  detectTokenStandard: jest.fn(),
  fetchNftCollectionInfo: jest.fn(),
  fetchNftMetadata: jest.fn(),
  fetchOwned721Ids: jest.fn(),
  fetchErc1155Balance: jest.fn(),
  fetchTokenUri: jest.fn(),
  isErc721Owner: jest.fn(),
  resolveIpfsUri: jest.fn((uri: string) =>
    uri.startsWith("ipfs://") ? `https://gateway.test/ipfs/${uri.slice("ipfs://".length)}` : uri,
  ),
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
  (_collections: NftCollectionGroup[]) => Promise.resolve(),
);

const mockDiscover = jest.fn<Promise<NFTInterface[]>, [string]>().mockResolvedValue([]);

const mount = () => {
  mockUseStore.mockReturnValue({
    qrlStore: { activeAccount: { accountAddress: HOLDER } },
    nftStore: {
      pendingDiscoveredNftCollections:
        groupDiscoveredNftsByCollection(discovered),
      discoverNftsForReview: mockDiscover,
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

beforeEach(() => {
  addDiscoveredCollections.mockClear();
  jest.mocked(isValidQrlAddress).mockReturnValue(false);
});
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

it("reports failed discovery without adding a collection", async () => {
  const error = new Error("Discovery unavailable");
  mockDiscover.mockRejectedValueOnce(error);
  mount();
  await waitFor(() => {
    expect(reportError).toHaveBeenCalledWith("Failed to discover NFTs:", error);
  });
  expect(addDiscoveredCollections).not.toHaveBeenCalled();
});

it("keeps the selected collections available after an add failure", async () => {
  addDiscoveredCollections.mockRejectedValueOnce(new Error("Storage unavailable"));
  mount();
  fireEvent.click(screen.getByLabelText(/Devnet Punks/));
  fireEvent.click(screen.getByText("Add Selected (1)"));
  expect((await screen.findByRole("alert")).textContent).toBe("Failed to add picks: Storage unavailable");
  expect(screen.getByText("Add Selected (1)")).toBeTruthy();
  expect(addDiscoveredCollections).toHaveBeenCalledTimes(1);
});

it("ignores metadata that resolves after the contract input changed", async () => {
  jest.mocked(isValidQrlAddress).mockImplementation((value) => value === DEVNET_PUNKS);
  jest.mocked(detectTokenStandard).mockResolvedValueOnce("ERC721");
  let resolveInfo: (value: NftCollectionInfo) => void = () => { throw new Error("Missing pending metadata"); };
  jest.mocked(fetchNftCollectionInfo).mockReturnValueOnce(new Promise((resolve) => { resolveInfo = resolve; }));
  mount();
  const input = screen.getByLabelText("Contract Address");
  fireEvent.change(input, { target: { value: DEVNET_PUNKS } });
  await waitFor(() => { expect(fetchNftCollectionInfo).toHaveBeenCalled(); });
  fireEvent.change(input, { target: { value: "invalid" } });
  await act(() => {
    resolveInfo({ standard: "ERC721", name: "Stale metadata", supportsEnumerable: true });
    return Promise.resolve();
  });
  expect(screen.queryByText("Stale metadata")).toBeNull();
  expect(screen.queryByText("Owner enumeration:")).toBeNull();
});

describe("discovered collection covers", () => {
  const mountWithCover = (image: string) => {
    mockUseStore.mockReturnValue({
      qrlStore: { activeAccount: { accountAddress: HOLDER } },
      nftStore: {
        pendingDiscoveredNftCollections: groupDiscoveredNftsByCollection([
          {
            contractAddress: DEVNET_PUNKS,
            standard: "ERC721",
            tokenId: "1",
            collectionName: "Devnet Punks",
            collectionSymbol: "DVP",
            image,
          },
        ]),
        discoverNftsForReview: mockDiscover,
        addDiscoveredCollections,
      },
    });
    return render(<AddNftModal isOpen onClose={jest.fn()} />);
  };

  it("shows the collection placeholder when the cover cannot load", () => {
    mountWithCover("https://art.example/1.png");
    // The dialog renders through a portal into document.body.
    const image = document.body.querySelector('img[src="https://art.example/1.png"]');
    if (!image) throw new Error("cover image not rendered");
    fireEvent.error(image);
    expect(screen.getByRole("img", { name: "Devnet Punks (image unavailable)" })).toBeTruthy();
    expect(document.body.querySelector('img[src="https://art.example/1.png"]')).toBeNull();
  });

  it("loads ipfs covers through the gateway", () => {
    mountWithCover("ipfs://bafycover/1.png");
    expect(
      document.body.querySelector('img[src="https://gateway.test/ipfs/bafycover/1.png"]'),
    ).toBeTruthy();
  });
});
