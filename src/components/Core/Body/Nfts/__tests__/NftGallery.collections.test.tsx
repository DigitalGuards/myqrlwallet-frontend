/** @jest-environment jsdom */
/**
 * The gallery lists collections first and drills down into one
 * collection's tokens, the way the browser extension's NFT collections
 * list does.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NFTInterface } from "@/constants";
import { groupNftsByCollection } from "@/utils/web3/nftCollections";
import { useStore } from "@/stores/store";
import NftGallery from "../NftGallery";

jest.mock("@/stores/store", () => ({ useStore: jest.fn() }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) =>
    values.filter((value) => typeof value === "string").join(" "),
  log: jest.fn(),
}));
jest.mock("react-router", () => ({ useNavigate: () => jest.fn() }));
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
  (useStore as jest.Mock).mockReturnValue({
    qrlStore: { activeAccount: { accountAddress: HOLDER } },
    nftStore: {
      nftCollections: groupNftsByCollection(nfts),
      pendingDiscoveredNftCollections: groupNftsByCollection(pending),
      refreshNftBalances: jest.fn(async () => undefined),
      refreshNftMetadata: jest.fn(async () => undefined),
      discoverNftsForReview: jest.fn(async () => []),
      hideNft: jest.fn(async () => undefined),
    },
  });
  return render(<NftGallery />);
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

it("drills into one collection and back", () => {
  mountWith(ownedNfts);

  fireEvent.click(screen.getByText("Devnet Punks"));
  expect(screen.getAllByText("Punk #1").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Punk #2").length).toBeGreaterThan(0);
  expect(screen.getByText("2 items")).toBeTruthy();

  fireEvent.click(screen.getByLabelText("Back to collections"));
  expect(screen.queryAllByText("Punk #1")).toHaveLength(0);
  expect(screen.getByText("2 collections")).toBeTruthy();
});

it("counts collections, not tokens, in the discovery empty state", () => {
  mountWith([], ownedNfts);
  expect(
    screen.getByText(/Explorer found this address to own/),
  ).toBeTruthy();
  expect(screen.getByText("2")).toBeTruthy();
  expect(screen.getByText(/NFT\s*collections/)).toBeTruthy();
});
