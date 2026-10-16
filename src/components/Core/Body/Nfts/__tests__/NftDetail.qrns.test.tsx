/** @jest-environment jsdom */

jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useParams } from "react-router";
import { useNetworkQrnsRecipient } from "@/hooks/useNetworkQrnsRecipient";
import type { UseQrnsRecipientResult } from "@/hooks/useQrnsRecipient";
import { normalizeQrlAddress } from "@/utils/web3/address";
import type { NFTInterface } from "@/constants";
import NftDetail from "../NftDetail";
import { FEE_NOT_SHOWN } from "@/utils/web3/feePolicy";

import { decryptStoredSeedWithPin } from "@/utils/crypto";
import { getRemainingAttempts, checkLockout } from "@/utils/crypto/pinAttemptTracker";
let mockDesktop = true;
jest.mock("@/components/UI/PinInput/PinInput", () => ({
  PinInput: ({ value, onChange, error }: { value: string; onChange: (pin: string) => void; error?: string }) => <div><input aria-label="PIN" value={value} onChange={(event) => { onChange(event.target.value); }} />{error && <p>{error}</p>}</div>,
}));
jest.mock("react-router", () => ({
  useNavigate: jest.fn(() => jest.fn()),
  useParams: jest.fn(),
  useLocation: jest.fn(() => ({ pathname: "/", search: "", state: null })),
}));
const mockUseStore = jest.fn<unknown, []>();
jest.mock("@/stores/store", () => ({ useStore: () => mockUseStore() }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) =>
    values.filter((value) => typeof value === "string").join(" "),
}));
jest.mock("@/router/router", () => ({ ROUTES: { HOME: "/" } }));
jest.mock("@/utils/storage", () => ({ StorageUtil: { getBlockChain: () => Promise.resolve("TEST_NET"), getEncryptedSeed: () => Promise.resolve("fixture") } }));
jest.mock("@/hooks/useNetworkQrnsRecipient", () => ({
  useNetworkQrnsRecipient: jest.fn(),
}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET: { explorer: "https://explorer.invalid" },
  },
}));
jest.mock("@/desktop/bridge", () => ({ get isDesktop() { return mockDesktop; } }));
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

beforeEach(() => { mockDesktop = true; localStorage.clear(); });
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
      const transferNft = jest.fn(() => Promise.resolve(true));
      const mockStore = {
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
      };
      mockUseStore.mockReturnValue(mockStore);
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

      await waitFor(() => { expect(transferNft).toHaveBeenCalledTimes(1); });
      expect(captureSubmission).toHaveBeenCalledWith("alice.qrl");
      expect(revalidateSubmission).toHaveBeenCalledTimes(1);
      expect(transferNft).toHaveBeenCalledWith(
        nft,
        RESOLVED_RECIPIENT,
        "",
        expectedAmount,
        "medium",
        // This screen shows no network fee yet, and says so rather than
        // leaving the argument off.
        FEE_NOT_SHOWN,
      );
    },
  );
});


it("counts wrong NFT transfer PINs and locks after five failures", async () => {
  mockDesktop = false;
  const transferNft = jest.fn();
  const nft: NFTInterface = {
    contractAddress: CONTRACT,
    tokenId: "7",
    standard: "ERC721",
    name: "Test NFT",
  };
  mockUseStore.mockReturnValue(
    {
      qrlStore: {
        activeAccount: { accountAddress: ACCOUNT },
        activeAccountSource: "seed",
        qrlConnection: { blockchain: "TEST_NET" },
        transactionStatus: { state: "idle" },
        resetTransactionStatus: jest.fn(),
      },
      nftStore: { nftList: [nft], transferNft },
    },
  );
  jest
    .mocked(useParams)
    .mockReturnValue({ contractAddress: CONTRACT, tokenId: "7" });
  jest.mocked(useNetworkQrnsRecipient).mockReturnValue(resolvedRecipient());
  jest
    .mocked(decryptStoredSeedWithPin)
    .mockRejectedValue(
      Object.assign(new Error("Incorrect PIN"), { code: "INCORRECT_PIN" }),
    );
  render(<NftDetail />);
  fireEvent.change(screen.getByLabelText("Recipient address or QNS name"), {
    target: { value: "alice.qrl" },
  });
  for (let attempt = 1; attempt <= 6; attempt++) {
    fireEvent.change(screen.getByLabelText("PIN"), {
      target: { value: `99999${attempt}` },
    });
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
      return Promise.resolve();
    });
    const failures = Math.min(attempt, 5);
    expect(getRemainingAttempts()).toBe(5 - failures);
    expect(decryptStoredSeedWithPin).toHaveBeenCalledTimes(failures);
    expect(
      screen.getByText(
        attempt >= 5
          ? "Too many failed attempts. Please wait 15 minutes."
          : `Incorrect PIN. ${5 - attempt} attempt${attempt === 4 ? "" : "s"} remaining.`,
      ),
    ).toBeTruthy();
  }
  expect(checkLockout().isLocked).toBe(true);
  expect(transferNft).not.toHaveBeenCalled();
});

it("shows invalid stored balance errors before attempting an NFT transfer", async () => {
  const nft: NFTInterface = { contractAddress: CONTRACT, tokenId: "7", standard: "ERC1155", balance: "invalid" };
  const transferNft = jest.fn();
  mockUseStore.mockReturnValue({
    qrlStore: {
      activeAccount: { accountAddress: ACCOUNT }, activeAccountSource: "seed", qrlConnection: { blockchain: "TEST_NET" },
      transactionStatus: { state: "idle" }, resetTransactionStatus: jest.fn(),
    },
    nftStore: { nftList: [nft], transferNft },
  });
  jest.mocked(useParams).mockReturnValue({ contractAddress: CONTRACT, tokenId: "7" });
  jest.mocked(useNetworkQrnsRecipient).mockReturnValue(resolvedRecipient());
  render(<NftDetail />);
  fireEvent.change(screen.getByLabelText("Recipient address or QNS name"), { target: { value: "alice.qrl" } });
  fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
  expect((await screen.findByRole("alert")).textContent).toContain("BigInt");
  expect(transferNft).not.toHaveBeenCalled();
  expect(nft.balance).toBe("invalid");
});
