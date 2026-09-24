/** @jest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useParams } from "react-router";
import { useStore } from "@/stores/store";
import { useNetworkQrnsRecipient } from "@/hooks/useNetworkQrnsRecipient";
import type { UseQrnsRecipientResult } from "@/hooks/useQrnsRecipient";
import { copyToClipboard } from "@/utils/nativeApp";
import { normalizeQrlAddress } from "@/utils/web3/address";
import type { NFTInterface } from "@/constants";
import NftDetail from "../NftDetail";

jest.mock("react-router", () => ({
  useNavigate: jest.fn(() => jest.fn()),
  useParams: jest.fn(),
}));
jest.mock("@/stores/store", () => ({ useStore: jest.fn() }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) =>
    values.filter((value) => typeof value === "string").join(" "),
}));
jest.mock("@/router/router", () => ({ ROUTES: { HOME: "/" } }));
jest.mock("@/utils/storage", () => ({ StorageUtil: {} }));
jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(async () => true),
}));
jest.mock("@/hooks/useNetworkQrnsRecipient", () => ({
  useNetworkQrnsRecipient: jest.fn(),
}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET: { explorer: "https://explorer.invalid" },
  },
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: true }));
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
jest.mock("../NftImage", () => ({ NftImage: () => null }));

function canonicalAddress(hexCharacter: string): string {
  const address = normalizeQrlAddress(`Q${hexCharacter.repeat(128)}`);
  if (!address) throw new Error("Test address must be valid");
  return address;
}

const ACCOUNT = canonicalAddress("1");
const CONTRACT = canonicalAddress("e");

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

function renderDetail() {
  const nft: NFTInterface = {
    contractAddress: CONTRACT,
    standard: "ERC721",
    tokenId: "2",
    collectionName: "Devnet Punks",
    collectionSymbol: "DVP",
  };
  const mockStore = Object.assign(Object.create(null), {
    qrlStore: {
      activeAccount: { accountAddress: ACCOUNT },
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
    nftStore: { nftList: [nft], transferNft: jest.fn() },
  });
  jest.mocked(useStore).mockReturnValue(mockStore);
  jest.mocked(useParams).mockReturnValue({
    contractAddress: CONTRACT,
    tokenId: "2",
  });
  jest.mocked(useNetworkQrnsRecipient).mockReturnValue(idleRecipient());

  return render(<NftDetail />);
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("NftDetail contract row", () => {
  it("keeps the explorer link and exposes the complete contract address", () => {
    const view = renderDetail();

    const link = view.getByRole("link", {
      name: "View contract on the explorer",
    });
    expect(link.getAttribute("href")).toBe(
      `https://explorer.invalid/address/${CONTRACT}`,
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("title")).toBe(CONTRACT);
    expect(view.getByLabelText(`QRL address ${CONTRACT}`)).toBeTruthy();
  });

  it("copies the full unmodified contract address and confirms it", async () => {
    const view = renderDetail();

    fireEvent.click(
      view.getByRole("button", { name: "Copy contract address" }),
    );

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(CONTRACT));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Address copied" })).toBeTruthy(),
    );
  });

  it("lets the contract value shrink and wrap so it stays inside the card", () => {
    const view = renderDetail();

    const row = view.getByText("Contract").parentElement;
    expect(row?.className).toContain("flex-wrap");

    const value = row?.lastElementChild;
    expect(value?.className).toContain("min-w-0");
    expect(value?.className).toContain("max-w-full");

    const addressText = view.getByLabelText(`QRL address ${CONTRACT}`);
    expect(addressText.className).toContain("whitespace-normal");
    expect(addressText.className).not.toContain("whitespace-nowrap");
    expect(addressText.parentElement?.className).toContain("min-w-0");
  });
});
