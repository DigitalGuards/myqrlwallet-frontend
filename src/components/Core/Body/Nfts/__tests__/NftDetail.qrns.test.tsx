/** @jest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useParams } from "react-router";
import { useStore } from "@/stores/store";
import { useNetworkQrnsRecipient } from "@/hooks/useNetworkQrnsRecipient";
import type { UseQrnsRecipientResult } from "@/hooks/useQrnsRecipient";
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
const CONTRACT = canonicalAddress("2");
const RESOLVED_RECIPIENT = canonicalAddress("3");

const captureSubmission = jest.fn(() => ({
  input: "alice.qrl",
  address: RESOLVED_RECIPIENT,
  bindingKey: "alice-binding",
}));
const revalidateSubmission = jest.fn(() => RESOLVED_RECIPIENT);

function resolvedRecipient(): UseQrnsRecipientResult {
  return {
    status: "success",
    source: "qrns",
    input: "alice.qrl",
    normalizedName: "alice.qrl",
    address: RESOLVED_RECIPIENT,
    message: "alice.qrl resolved successfully.",
    bindingKey: "alice-binding",
    captureSubmission,
    revalidateSubmission,
  };
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("NftDetail QRNS recipient flow", () => {
  it.each([
    { standard: "ERC721" as const, amount: "1", expectedAmount: 1n },
    { standard: "ERC1155" as const, amount: "2", expectedAmount: 2n },
  ])(
    "passes the concrete resolved address to the $standard encoder path",
    async ({ standard, amount, expectedAmount }) => {
      const nft: NFTInterface = {
        contractAddress: CONTRACT,
        standard,
        tokenId: "7",
        name: "QRNS test NFT",
        balance: standard === "ERC1155" ? "5" : undefined,
      };
      const transferNft = jest.fn(async () => true);
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
        nftStore: { nftList: [nft], transferNft },
      });
      jest.mocked(useStore).mockReturnValue(mockStore);
      jest.mocked(useParams).mockReturnValue({
        contractAddress: CONTRACT,
        tokenId: "7",
      });
      jest.mocked(useNetworkQrnsRecipient).mockReturnValue(resolvedRecipient());

      const view = render(<NftDetail />);
      expect(view.getByPlaceholderText("QRL address or QNS name")).toBeTruthy();
      fireEvent.change(view.getByLabelText("Recipient address or QNS name"), {
        target: { value: "alice.qrl" },
      });
      if (standard === "ERC1155") {
        fireEvent.change(view.getByLabelText("Amount"), {
          target: { value: amount },
        });
      }
      fireEvent.click(view.getByRole("button", { name: "Transfer" }));

      await waitFor(() => expect(transferNft).toHaveBeenCalledTimes(1));
      expect(captureSubmission).toHaveBeenCalledWith("alice.qrl");
      expect(revalidateSubmission).toHaveBeenCalledTimes(1);
      expect(transferNft).toHaveBeenCalledWith(
        nft,
        RESOLVED_RECIPIENT,
        "",
        expectedAmount,
      );
    },
  );
});
