/** @jest-environment jsdom */
// The PIN unlock takes a second or two. An account, network or provider
// change while it runs must stop the NFT transfer before anything is signed
// or broadcast, and the PIN accounting must stay exactly as it was.
jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { configure, observable, runInAction } from "mobx";
import { useParams } from "react-router";
import { useNetworkQrnsRecipient } from "@/hooks/useNetworkQrnsRecipient";
import type { UseQrnsRecipientResult } from "@/hooks/useQrnsRecipient";
import { normalizeQrlAddress } from "@/utils/web3/address";
import type { NFTInterface } from "@/constants";
import { decryptStoredSeedWithPin } from "@/utils/crypto";
import {
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from "@/utils/crypto/pinAttemptTracker";
import { deferred } from "@/test-utils/deferred";
import NftDetail from "../NftDetail";

configure({ enforceActions: "never" });

jest.mock("@/components/UI/PinInput/PinInput", () => ({
  PinInput: ({ value, onChange }: { value: string; onChange: (pin: string) => void }) => (
    <input aria-label="PIN" value={value} onChange={(event) => { onChange(event.target.value); }} />
  ),
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
  QRL_PROVIDER: { TEST_NET: { explorer: "https://explorer.invalid" } },
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/utils/crypto", () => ({
  DeviceCredentialUnavailableError: class extends Error {},
  decryptStoredSeedWithPin: jest.fn(),
  getAddressFromMnemonicAsync: jest.fn(),
}));
// The real limiter and tracker run; the two writes are observed.
jest.mock("@/utils/crypto/pinAttemptTracker", () => ({
  ...jest.requireActual<typeof import("@/utils/crypto/pinAttemptTracker")>(
    "@/utils/crypto/pinAttemptTracker",
  ),
  recordSuccessfulAttempt: jest.fn(),
  recordFailedAttempt: jest.fn(),
}));
// Always current, so the check under test is the only thing that can stop
// the transfer.
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: { captureGeneration: () => 0, isCurrent: () => true },
}));
jest.mock("../NftImage", () => ({ NftImage: () => null }));

function canonicalAddress(hexCharacter: string): string {
  const address = normalizeQrlAddress(`Q${hexCharacter.repeat(128)}`);
  if (!address) throw new Error("Test address must be valid");
  return address;
}
const ACCOUNT = canonicalAddress("1");
const OTHER = canonicalAddress("4");
const CONTRACT = canonicalAddress("2");
const RECIPIENT = canonicalAddress("3");

// Distinct contents: the store's struct comparer treats equal ones as one.
let providerCount = 0;
class FakeProvider {
  readonly id = ++providerCount;
}

const nft: NFTInterface = {
  contractAddress: CONTRACT,
  standard: "ERC721",
  tokenId: "7",
  name: "Test NFT",
};

function recipient(): UseQrnsRecipientResult {
  return {
    status: "success",
    source: "qrns",
    input: "alice.qrl",
    normalizedName: "alice.qrl",
    address: RECIPIENT,
    message: "alice.qrl resolved successfully.",
    bindingKey: "alice-binding",
    captureSubmission: () => ({ input: "alice.qrl", address: RECIPIENT, bindingKey: "alice-binding" }),
    revalidateSubmission: () => RECIPIENT,
  };
}

let qrlStore: {
  activeAccount: { accountAddress: string };
  activeAccountSource: string;
  qrlConnection: { blockchain: string };
  qrlInstance: FakeProvider;
};
const transferNft = jest.fn(() => Promise.resolve(true));

beforeEach(() => {
  qrlStore = observable(
    {
      activeAccount: { accountAddress: ACCOUNT },
      activeAccountSource: "seed",
      qrlConnection: { blockchain: "TEST_NET" },
      qrlInstance: new FakeProvider(),
      transactionStatus: { state: "idle", txHash: null, receipt: null, error: null },
      resetTransactionStatus: () => {},
    },
    {
      activeAccount: observable.struct,
      qrlConnection: observable.struct,
      qrlInstance: observable.struct,
    },
  );
  mockUseStore.mockReturnValue({ qrlStore, nftStore: { nftList: [nft], transferNft } });
  jest.mocked(useParams).mockReturnValue({ contractAddress: CONTRACT, tokenId: "7" });
  jest.mocked(useNetworkQrnsRecipient).mockReturnValue(recipient());
  const crypto = jest.requireMock<{ getAddressFromMnemonicAsync: jest.Mock }>("@/utils/crypto");
  crypto.getAddressFromMnemonicAsync.mockResolvedValue(ACCOUNT);
});
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

async function startTransfer() {
  const unlock = deferred<{ mnemonic: string; hexSeed: string }>();
  jest.mocked(decryptStoredSeedWithPin).mockReturnValue(unlock.promise);
  render(<NftDetail />);
  fireEvent.change(screen.getByLabelText("Recipient address or QNS name"), {
    target: { value: "alice.qrl" },
  });
  fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
  await act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    return Promise.resolve();
  });
  await waitFor(() => {
    expect(decryptStoredSeedWithPin).toHaveBeenCalledTimes(1);
  });
  return unlock;
}

it.each<[string, () => void]>([
  ["account", () => { qrlStore.activeAccount = { accountAddress: OTHER }; }],
  ["network", () => { qrlStore.qrlConnection = { blockchain: "MAIN_NET" }; }],
  ["provider", () => { qrlStore.qrlInstance = new FakeProvider(); }],
  ["source", () => { qrlStore.activeAccountSource = "extension"; }],
])("transfers nothing when the %s changes during the unlock", async (_name, change) => {
  const unlock = await startTransfer();
  act(() => { runInAction(change); });
  await act(async () => {
    unlock.resolve({ mnemonic: "fixture", hexSeed: "00" });
    await Promise.resolve();
  });
  expect(
    await screen.findByText("Wallet changed while preparing the NFT transfer"),
  ).toBeTruthy();
  expect(transferNft).not.toHaveBeenCalled();
  expect(recordFailedAttempt).not.toHaveBeenCalled();
  expect(recordSuccessfulAttempt).toHaveBeenCalledTimes(1);
});

it.each<[string, () => void]>([
  ["account", () => { qrlStore.activeAccount = { accountAddress: OTHER }; }],
  ["network", () => { qrlStore.qrlConnection = { blockchain: "MAIN_NET" }; }],
])("refuses a tap made on a render that predates the %s change", async (_name, change) => {
  jest.mocked(decryptStoredSeedWithPin).mockResolvedValue({ mnemonic: "fixture", hexSeed: "00" });
  render(<NftDetail />);
  fireEvent.change(screen.getByLabelText("Recipient address or QNS name"), {
    target: { value: "alice.qrl" },
  });
  fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
  // One batch: React has not re-rendered when the tap handler runs.
  await act(() => {
    runInAction(change);
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    return Promise.resolve();
  });
  expect(
    await screen.findByText("Wallet changed while preparing the NFT transfer"),
  ).toBeTruthy();
  expect(decryptStoredSeedWithPin).not.toHaveBeenCalled();
  expect(transferNft).not.toHaveBeenCalled();
});

it("transfers exactly once when nothing changes", async () => {
  const unlock = await startTransfer();
  await act(async () => {
    unlock.resolve({ mnemonic: "fixture", hexSeed: "00" });
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(transferNft).toHaveBeenCalledTimes(1);
  });
  expect(recordSuccessfulAttempt).toHaveBeenCalledTimes(1);
  expect(recordFailedAttempt).not.toHaveBeenCalled();
});
