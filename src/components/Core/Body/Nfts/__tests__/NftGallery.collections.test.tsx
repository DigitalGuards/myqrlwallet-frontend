/** @jest-environment jsdom */
/**
 * The gallery lists collections first and drills down into one
 * collection's tokens, the way the browser extension's NFT collections
 * list does.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { NFTInterface } from "@/constants";
import { groupNftsByCollection } from "@/utils/web3/nftCollections";
import { reportError } from "@/utils/reportError";
import NftGallery from "../NftGallery";

jest.mock("@/utils/reportError", () => ({ reportError: jest.fn() }));
const mockUseStore = jest.fn<unknown, []>();
jest.mock("@/stores/store", () => ({ useStore: () => mockUseStore() }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) =>
    values.filter((value) => typeof value === "string").join(" "),
  log: jest.fn(),
}));
// Drill-down navigation (URL parameter, Back, browser history) has its
// own suite: NftCollectionNavigation.test.tsx. Here the router is a
// static stub showing the collection list.
jest.mock("react-router", () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: "/", search: "", state: null }),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}));
jest.mock("@/router/router", () => ({
  ROUTES: { NFT_DETAIL: "/nft/:contractAddress/:tokenId" },
}));
jest.mock("../AddNftModal", () => ({ AddNftModal: () => null }));
jest.mock("@/utils/web3/nft", () => ({
  nftKey: (contractAddress: string, tokenId: string) =>
    `${contractAddress.toLowerCase()}:${tokenId}`,
  resolveIpfsUri: (uri: string) => uri,
}));
jest.mock("../NftImage", () => ({
  NftImage: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

const NAMELESS_1155 = `Q1222c5738d10574ec8ab9ee530f0f8e70817b687206e0989dc3f1a6c7722fa5715e3fa4750de7021880b7a14c328476f1f93aafb7b4d96135b5a5684210eb6cf`;
const DEVNET_PUNKS = `Qeb637802b80f5982ceb89dab30802437ac068c7b0f706fa8dff26df1021a18ff01e02f6661521caf64103891ec409ef707a3eb47be5c33e9a022a63d92d6356d`;
const HOLDER = `Qa73c065f7018cc0cfff98028d8ef1ff746f5cb425bc8840a4cdc2a6eb717faa121a2e959a6a0dac2d7c38252d70e4541397b0967880f00b9bd0c4c5d0fc46b2d`;

const ownedNfts: NFTInterface[] = [
  ...["2", "5", "6"].map((tokenId) => ({
    contractAddress: NAMELESS_1155,
    standard: "ERC1155" as const,
    tokenId,
    balance: "65",
  })),
  ...["1", "2"].map((tokenId) => ({
    contractAddress: DEVNET_PUNKS,
    standard: "ERC721" as const,
    tokenId,
    name: `Punk #${tokenId}`,
    collectionName: "Devnet Punks",
    collectionSymbol: "DVP",
  })),
];

const mountWith = (nfts: NFTInterface[], pending: NFTInterface[] = []) => {
  const store = {
    qrlStore: { activeAccount: { accountAddress: HOLDER } },
    nftStore: {
      nftCollections: groupNftsByCollection(nfts),
      pendingDiscoveredNftCollections: groupNftsByCollection(pending),
      refreshNftBalances: jest.fn(() => Promise.resolve()),
      refreshNftMetadata: jest.fn(() => Promise.resolve()),
      discoverNftsForReview: jest.fn(() => Promise.resolve([])),
      hideNft: jest.fn(() => Promise.resolve()),
    },
  };
  mockUseStore.mockReturnValue(store);
  return { ...render(<NftGallery />), store };
};

afterEach(cleanup);

it("lists collections with item counts, standard, and short contract address", () => {
  mountWith(ownedNfts);

  expect(screen.getByText("2 collections")).toBeTruthy();
  expect(screen.getByText("Devnet Punks")).toBeTruthy();
  expect(screen.getByText(/2 items · ERC-721 · Qeb63780/)).toBeTruthy();
  expect(screen.getByText(/3 items · ERC-1155 · Q1222c573/)).toBeTruthy();
  // No token row is rendered at the collection level.
  expect(screen.queryByText("Punk #1")).toBeNull();
});

it("counts collections, not tokens, in the discovery empty state", () => {
  mountWith([], ownedNfts);
  expect(screen.getByText(/Explorer found this address to own/)).toBeTruthy();
  expect(
    screen.getByText("Explorer found this address to own 2 NFT collections."),
  ).toBeTruthy();
  expect(screen.getByText(/NFT\s*collections/)).toBeTruthy();
});

it("reports refresh failures, preserves the collection rows, and allows retry", async () => {
  const { store } = mountWith(ownedNfts);
  await waitFor(() => {
    expect(store.nftStore.refreshNftMetadata).toHaveBeenCalledTimes(1);
  });
  const error = new Error("RPC unavailable");
  store.nftStore.refreshNftBalances.mockRejectedValueOnce(error);
  const refresh = screen.getByRole("button", {
    name: "Refresh ownership, balances, and metadata",
  });
  fireEvent.click(refresh);
  await waitFor(() => {
    expect(reportError).toHaveBeenCalledWith("Failed to refresh NFTs:", error);
  });
  expect(refresh.getAttribute("disabled")).toBeNull();
  expect(screen.getByText("2 collections")).toBeTruthy();
  expect(store.nftStore.refreshNftMetadata).toHaveBeenCalledTimes(1);
  fireEvent.click(refresh);
  await waitFor(() => {
    expect(store.nftStore.refreshNftMetadata).toHaveBeenLastCalledWith(true);
  });
});
