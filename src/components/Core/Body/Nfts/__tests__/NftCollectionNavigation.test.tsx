/** @jest-environment jsdom */
/**
 * Back from an NFT detail page returns to the collection the user came
 * from, and the in-app Back buttons stay in step with the browser Back
 * button. The open collection lives in the URL, so every hop is one
 * history entry and a deep link into a detail page still has somewhere
 * sensible to go back to.
 */
import {
  fakeHistory,
  fakeRouterModule as mockRouterModule,
  useFakeLocation,
} from "./fakeRouterHistory";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NFTInterface } from "@/constants";
import { groupNftsByCollection } from "@/utils/web3/nftCollections";
import { useStore } from "@/stores/store";
import type { UseQrnsRecipientResult } from "@/hooks/useQrnsRecipient";
import { useNetworkQrnsRecipient } from "@/hooks/useNetworkQrnsRecipient";
import NftGallery from "../NftGallery";
import NftDetail from "../NftDetail";

jest.mock("react-router", () => mockRouterModule());
jest.mock("@/stores/store", () => ({ useStore: jest.fn() }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) =>
    values.filter((value) => typeof value === "string").join(" "),
  log: jest.fn(),
}));
jest.mock("@/router/router", () => ({
  ROUTES: { HOME: "/", NFT_DETAIL: "/nft/:contractAddress/:tokenId" },
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
jest.mock("@/utils/storage", () => ({ StorageUtil: {} }));
jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(async () => true),
}));
jest.mock("@/hooks/useNetworkQrnsRecipient", () => ({
  useNetworkQrnsRecipient: jest.fn(),
}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { explorer: "https://explorer.invalid" } },
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/utils/crypto", () => ({
  DeviceCredentialUnavailableError: class extends Error {},
  decryptStoredSeedWithPin: jest.fn(),
  getAddressFromMnemonicAsync: jest.fn(),
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: {
    captureGeneration: jest.fn(),
    isCurrent: jest.fn(() => true),
  },
}));

const NAMELESS_1155 = `Q1222c5738d10574ec8ab9ee530f0f8e70817b687206e0989dc3f1a6c7722fa5715e3fa4750de7021880b7a14c328476f1f93aafb7b4d96135b5a5684210eb6cf`;
const DEVNET_PUNKS = `Qeb637802b80f5982ceb89dab30802437ac068c7b0f706fa8dff26df1021a18ff01e02f6661521caf64103891ec409ef707a3eb47be5c33e9a022a63d92d6356d`;
const UNOWNED = `Qdd637802b80f5982ceb89dab30802437ac068c7b0f706fa8dff26df1021a18ff01e02f6661521caf64103891ec409ef707a3eb47be5c33e9a022a63d92d6356d`;
const HOLDER = `Qa73c065f7018cc0cfff98028d8ef1ff746f5cb425bc8840a4cdc2a6eb717faa121a2e959a6a0dac2d7c38252d70e4541397b0967880f00b9bd0c4c5d0fc46b2d`;

const ownedNfts: NFTInterface[] = [
  ...["2", "5"].map((tokenId) => ({
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

function idleRecipient(): UseQrnsRecipientResult {
  return {
    status: "idle",
    source: null,
    input: "",
    normalizedName: null,
    address: null,
    message: null,
    bindingKey: "",
    captureSubmission: jest.fn(() => null),
    revalidateSubmission: jest.fn(() => null),
  };
}

/**
 * Minimal shell standing in for the router: the home page renders the
 * gallery, an /nft/... path renders the detail page. Both read the same
 * fake history, so a click that navigates really moves between them.
 */
const AppShell = () => {
  const location = useFakeLocation();
  return location.pathname.startsWith("/nft/") ? <NftDetail /> : <NftGallery />;
};

/** First match, for names the card renders both as text and as alt text. */
function firstByText(text: string): HTMLElement {
  const [first] = screen.getAllByText(text);
  if (!first) throw new Error(`No element rendered the text ${text}`);
  return first;
}

function mountApp(nfts: NFTInterface[] = ownedNfts) {
  // Object.create(null) keeps the literal structurally typed as the store
  // the component consumes, the way the other NFT suites mock it.
  const mockStore = Object.assign(Object.create(null), {
    qrlStore: {
      activeAccount: { accountAddress: HOLDER },
      activeAccountSource: "seed",
      qrlConnection: { blockchain: "TEST_NET" },
      transactionStatus: {
        state: "idle",
        txHash: null,
        receipt: null,
        error: null,
      },
      resetTransactionStatus: jest.fn(),
    },
    nftStore: {
      nftList: nfts,
      nftCollections: groupNftsByCollection(nfts),
      pendingDiscoveredNftCollections: [],
      refreshNftBalances: jest.fn(async () => undefined),
      refreshNftMetadata: jest.fn(async () => undefined),
      discoverNftsForReview: jest.fn(async () => []),
      hideNft: jest.fn(async () => undefined),
      transferNft: jest.fn(),
    },
  });
  jest.mocked(useStore).mockReturnValue(mockStore);
  jest.mocked(useNetworkQrnsRecipient).mockReturnValue(idleRecipient());
  return render(<AppShell />);
}

beforeEach(() => {
  fakeHistory.reset("/");
  jest.clearAllMocks();
});
afterEach(cleanup);

describe("NFT collection drill-down navigation", () => {
  it("puts the open collection in the URL and steps back out of it", () => {
    mountApp();

    fireEvent.click(screen.getByText("Devnet Punks"));
    expect(fakeHistory.current().search).toBe(
      `?collection=${DEVNET_PUNKS.toLowerCase()}`,
    );
    expect(screen.getAllByText("Punk #1").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText("Back to collections"));
    expect(fakeHistory.current().search).toBe("");
    expect(screen.getByText("2 collections")).toBeTruthy();
    // Popped the pushed entry instead of stacking a new one: the
    // collection view is still one step forward, exactly where the
    // browser Back button would have left it.
    expect(fakeHistory.index()).toBe(0);
    expect(fakeHistory.length()).toBe(2);
  });

  it("returns from an NFT detail page to the collection it was opened from", () => {
    mountApp();

    fireEvent.click(screen.getByText("Devnet Punks"));
    fireEvent.click(firstByText("Punk #1"));
    expect(fakeHistory.current().pathname).toBe(
      `/nft/${DEVNET_PUNKS}/1`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(fakeHistory.current().pathname).toBe("/");
    expect(fakeHistory.current().search).toBe(
      `?collection=${DEVNET_PUNKS.toLowerCase()}`,
    );
    // The collection is open again, with its tokens listed.
    expect(screen.getAllByText("Punk #2").length).toBeGreaterThan(0);
    expect(screen.getByText("2 items")).toBeTruthy();
  });

  it("keeps the browser Back button in step with the in-app one", () => {
    mountApp();

    fireEvent.click(screen.getByText("Devnet Punks"));
    fireEvent.click(firstByText("Punk #1"));

    // Browser Back: detail page -> collection view.
    fakeHistory.back();
    expect(screen.getAllByText("Punk #1").length).toBeGreaterThan(0);
    expect(screen.getByText("Devnet Punks")).toBeTruthy();

    // Browser Back again: collection view -> collection list.
    fakeHistory.back();
    expect(screen.getByText("2 collections")).toBeTruthy();

    // Browser Forward returns to the collection view.
    fakeHistory.forward();
    expect(screen.getByText("2 items")).toBeTruthy();
  });

  it("opens the collection view for a deep-linked NFT with no history", () => {
    fakeHistory.reset(`/nft/${DEVNET_PUNKS}/2`);
    mountApp();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(fakeHistory.current().pathname).toBe("/");
    expect(fakeHistory.current().search).toBe(
      `?collection=${DEVNET_PUNKS.toLowerCase()}`,
    );
    expect(screen.getByText("2 items")).toBeTruthy();
    // Replaced the deep-linked entry, so Back does not bounce the user
    // straight back into the detail page.
    expect(fakeHistory.length()).toBe(1);
  });

  it("falls back to the wallet home when the collection is not held", () => {
    fakeHistory.reset(`/nft/${UNOWNED}/7`);
    mountApp();

    // The token is unknown to the wallet, so the detail page renders its
    // not-found card with the same Back button.
    expect(screen.getByText(/NFT not found in your wallet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(fakeHistory.current().pathname).toBe("/");
    expect(fakeHistory.current().search).toBe("");
    expect(screen.getByText("2 collections")).toBeTruthy();
  });

  it("restores the open collection when a deep link carries one", () => {
    fakeHistory.reset(`/?collection=${NAMELESS_1155.toLowerCase()}`);
    mountApp();

    expect(screen.getByText("2 items")).toBeTruthy();
    expect(screen.getByLabelText("Back to collections")).toBeTruthy();

    // Nothing to pop, so the parameter is dropped in place.
    fireEvent.click(screen.getByLabelText("Back to collections"));
    expect(fakeHistory.current().search).toBe("");
    expect(fakeHistory.length()).toBe(1);
    expect(screen.getByText("2 collections")).toBeTruthy();
  });
});
