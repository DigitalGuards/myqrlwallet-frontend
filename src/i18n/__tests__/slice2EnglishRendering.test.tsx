/** @jest-environment jsdom */
// English oracle: run this unchanged harness against origin/dev
// 13d7254e460b1685d1d3fb02b9bd23ec91dad141 before copying its snapshots here.
import { TextEncoder } from "node:util";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactElement } from "react";
import { HelmetProvider } from "react-helmet-async";
import type { HistoryRow } from "@/utils/transactionHistory";
import type { SendReceipt, SendSigner } from "@/utils/sendStatus";
import type { TransactionStatus } from "@/stores/qrlStore";
import type { QrnsRecipientState } from "@/hooks/useQrnsRecipient";
import type { NativeMessage } from "@/utils/nativeApp";
import Transfer from "@/components/Core/Body/Transfer/Transfer";
import { SendStatus } from "@/components/Core/Body/Transfer/SendStatus";
import { GasFeeNotice } from "@/components/Core/Body/Transfer/GasFeeNotice/GasFeeNotice";
import { TransactionSuccessful } from "@/components/Core/Body/Transfer/TransactionSuccessful/TransactionSuccessful";
import TransactionHistory from "@/components/Core/Body/TransactionHistory/TransactionHistory";
import AccountList from "@/components/Core/Body/AccountList/AccountList";
import { ActiveAccount } from "@/components/Core/Body/AccountList/ActiveAccount/ActiveAccount";
import { OtherAccounts } from "@/components/Core/Body/AccountList/OtherAccounts/OtherAccounts";
import { AccountId } from "@/components/Core/Body/AccountList/AccountId/AccountId";
import { AccountBalance } from "@/components/Core/Body/AccountList/AccountBalance/AccountBalance";
import { CopyAddressButton } from "@/components/Core/Body/AccountList/CopyAddressButton/CopyAddressButton";
import { ExtensionBadge } from "@/components/Core/Body/AccountList/ExtensionBadge/ExtensionBadge";
import { MobileBadge } from "@/components/Core/Body/AccountList/MobileBadge/MobileBadge";
import AddressBook from "@/components/Core/Body/AddressBook/AddressBook";
import { AddressBookPicker } from "@/components/Core/Body/AddressBook/AddressBookPicker";
import { RecipientResolutionStatus } from "@/components/Core/RecipientResolutionStatus";
import { DeviceCredentialUnavailableError } from "@/utils/crypto";
import { PinVerificationError } from "@/utils/crypto/verifyPinWithLimit";
import { deferred } from "@/test-utils/deferred";

const FROM = `Q${"1".repeat(128)}`;
const mockTo = `Q${"2".repeat(128)}`;
const CONTRACT = `Q${"3".repeat(128)}`;
const HASH = `0x${"a".repeat(64)}`;
const receipt: SendReceipt = {
  transactionHash: HASH,
  blockHash: `0x${"b".repeat(64)}`,
  blockNumber: 42n,
  gasUsed: 21000n,
  effectiveGasPrice: 100n,
  status: 1n,
};
let mockNative = false;
let mockDesktop = false;
let mockAsset = "native";
let mockWalletLimit = false;
let mockHistoryNetwork: string | null = "testnet";
let mockRows: HistoryRow[] | null = null;
let mockStorageUnavailable = false;
let mockStoredSeed: string | null = "fixture";
let mockSender = FROM;
let mockCurrentWallet = true;
let mockCapture = true;
let mockRevalidate = true;
let mockNativeListener: ((message: NativeMessage) => void) | undefined;
const mockEstimate = jest.fn<Promise<unknown>, []>();
const mockSend = jest.fn<Promise<boolean>, unknown[]>();
const mockDecrypt = jest.fn<Promise<{ mnemonic: string }>, []>();
const mockPost = jest.fn<Promise<{ data: unknown }>, unknown[]>();
const mockCopy = jest.fn<Promise<boolean>, [string]>();
let mockResolution: QrnsRecipientState;
const idle = (): TransactionStatus => ({
  state: "idle",
  txHash: null,
  receipt: null,
  error: null,
});
function fixture() {
  return {
    qrlStore: {
      activeAccount: { accountAddress: FROM },
      activeAccountSource: "seed",
      qrlAccounts: {
        accounts: [
          { accountAddress: mockTo, source: "extension" },
          { accountAddress: CONTRACT, source: "mobile" },
        ],
      },
      qrlConnection: {
        blockchain: "TEST_NET",
        isConnected: true,
        isLoading: false,
      },
      qrlInstance: { estimateGas: mockEstimate },
      getAccountBalance: () => "123.456789",
      estimateNativeTransferFee: () => Promise.resolve("0.001"),
      transactionStatus: idle(),
      resetTransactionStatus: jest.fn(),
      signAndSendTransaction: mockSend,
      sendTransactionViaProvider: mockSend,
      setActiveAccount: () => Promise.resolve(),
    },
    tokenStore: {
      visibleTokenList: [
        {
          address: CONTRACT,
          name: "Example token",
          symbol: "EX",
          decimals: 6,
          amount: "10",
        },
      ],
      sendToken: mockSend,
    },
  };
}
let mockStore = fixture();
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("@/stores/qrlStore", () => ({
  quoteFees: () =>
    Promise.resolve({
      expectedFeePerGas: 3n,
      maxFeePerGas: 5n,
      maxPriorityFeePerGas: 1n,
    }),
}));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("react-router", () => ({
  useLocation: () => ({ pathname: "/transfer", state: null }),
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams({ asset: mockAsset }), jest.fn()],
  Link: ({
    to,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props} />
  ),
}));
jest.mock("@/router/router", () => ({
  ROUTES: {
    HOME: "/",
    TRANSFER: "/transfer",
    IMPORT_ACCOUNT: "/import",
    CREATE_ACCOUNT: "/create",
    ADDRESS_BOOK: "/address-book",
  },
}));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
}));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
  historyNetwork: () => mockHistoryNetwork,
}));
jest.mock("@/config", () => ({
  SERVER_URL: "https://wallet.example/api",
  QRL_PROVIDER: {
    TEST_NET: {
      id: "TEST_NET",
      url: "https://rpc.example",
      explorer: "https://explorer.example",
    },
  },
  getExplorerAddressUrl: () => "https://explorer.example/address",
  getExplorerTxUrl: (hash: string) => `https://explorer.example/tx/${hash}`,
}));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => mockNative,
  copyToClipboard: (value: string) => mockCopy(value),
  openExternalUrl: jest.fn(),
  shareContent: jest.fn(),
  requestQRScan: jest.fn(),
  triggerHaptic: jest.fn(),
  notifyContactsUpdated: jest.fn(),
  subscribeToNativeMessages: (listener: (message: NativeMessage) => void) => {
    mockNativeListener = listener;
    return () => {
      mockNativeListener = undefined;
    };
  },
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getBlockChain: () => Promise.resolve("TEST_NET"),
    getEncryptedSeed: () => Promise.resolve(mockStoredSeed),
    getMaxWallets: () => 10,
    isWalletLimitReached: () => Promise.resolve(mockWalletLimit),
    getWalletCount: () => Promise.resolve(mockWalletLimit ? 10 : 1),
  },
}));
jest.mock("@/utils/crypto", () => ({
  DeviceCredentialUnavailableError: class extends Error {},
  decryptStoredSeedWithPin: () => mockDecrypt(),
  getAddressFromMnemonicAsync: () => Promise.resolve(mockSender),
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: {
    captureGeneration: () => 0,
    isCurrent: () => mockCurrentWallet,
  },
}));
jest.mock("@/utils/web3", () => ({
  fetchBalance: () => Promise.resolve(10000000n),
  isValidQrlAddress: (value: string) => /^Q[0-9a-f]{128}$/i.test(value),
}));
jest.mock("@/hooks/useNetworkQrnsRecipient", () => ({
  useNetworkQrnsRecipient: () => ({
    ...mockResolution,
    captureSubmission: (input: string) =>
      mockCapture ? { input, address: mockTo, bindingKey: "recipient" } : null,
    revalidateSubmission: () => (mockRevalidate ? mockTo : null),
  }),
}));
jest.mock("@/hooks/useTransactionHistory", () => ({
  useTransactionHistory: (
    _chain: unknown,
    _address: unknown,
    rows: HistoryRow[],
  ) => ({
    transactions: mockRows ?? rows,
    storageUnavailable: mockStorageUnavailable,
  }),
}));
jest.mock("axios", () => ({
  post: (...args: unknown[]) => mockPost(...args),
  isAxiosError: (error: unknown) =>
    error instanceof Error && "response" in error,
}));
jest.mock("@/utils/extension", () => ({
  discoverQrlProviders: () => Promise.resolve([]),
}));
jest.mock("@/utils/mobileConnect/mobileConnection", () => ({
  subscribeMobileStatus: () => () => undefined,
  disconnectMobile: () => Promise.resolve(),
}));
jest.mock("@/utils/log", () => ({ logger: { error: jest.fn() } }));

class ResizeObserverFixture {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockNative = false;
  mockDesktop = false;
  mockAsset = "native";
  mockWalletLimit = false;
  mockHistoryNetwork = "testnet";
  mockRows = null;
  mockStorageUnavailable = false;
  mockStoredSeed = "fixture";
  mockSender = FROM;
  mockCurrentWallet = true;
  mockCapture = true;
  mockRevalidate = true;
  mockResolution = {
    status: "success",
    source: "direct",
    input: mockTo,
    address: mockTo,
    normalizedName: null,
    message: "Recipient address verified.",
    bindingKey: "recipient",
  };
  mockEstimate.mockResolvedValue(21000n);
  mockSend.mockResolvedValue(true);
  mockDecrypt.mockResolvedValue({ mnemonic: "fixture" });
  mockPost.mockResolvedValue({ data: { transactions: [] } });
  mockCopy.mockResolvedValue(true);
  mockStore = fixture();
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverFixture,
  });
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: jest.fn(),
  });
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function show(element: ReactElement) {
  await act(async () => {
    render(<HelmetProvider>{element}</HelmetProvider>);
    await Promise.resolve();
  });
}
function snapshot() {
  const copy = document.body.cloneNode(true);
  if (!(copy instanceof HTMLElement)) throw new Error("Missing body");
  copy
    .querySelectorAll("style, script, [hidden], [aria-hidden=true], .sr-only")
    .forEach((element) => {
      element.remove();
    });
  expect({
    text: copy.textContent,
    labels: [
      ...copy.querySelectorAll("[aria-label], [title], [alt], [placeholder]"),
    ].map((element) =>
      ["aria-label", "title", "alt", "placeholder"].flatMap((name) =>
        element.hasAttribute(name) ? [[name, element.getAttribute(name)]] : [],
      ),
    ),
  }).toMatchSnapshot();
}
async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await Promise.resolve();
  });
}
async function fillTransfer(amount = "1.234567", pin = "123456") {
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText("QRL address or QNS name"), {
      target: { value: mockTo },
    });
    fireEvent.change(screen.getByPlaceholderText("Enter amount"), {
      target: { value: amount },
    });
    for (const [index, digit] of Array.from(pin).entries())
      fireEvent.change(screen.getByLabelText(`PIN digit ${index + 1}`), {
        target: { value: digit },
      });
    await Promise.resolve();
  });
}
function row(state: HistoryRow["state"], index = 0): HistoryRow {
  return {
    ID: String(index),
    InOut: index % 2 ? 1 : 0,
    TxType: "0x2",
    Address: FROM,
    From: FROM,
    To: mockTo,
    TxHash: `0x${String(index).repeat(64)}`,
    TimeStamp: "0x42",
    Amount: "1.234567",
    BlockNumber: "0x42",
    PaidFees: "0.001",
    state,
  };
}
function contacts() {
  localStorage.setItem(
    "qrl:addressBook:qip55:v2",
    JSON.stringify([
      { id: "one", name: "Savings <safe>", address: mockTo, createdAt: 0 },
    ]),
  );
}

it.each(["seed", "extension", "mobile", "desktop"] satisfies SendSigner[])(
  "Transfer form: %s",
  async (signer) => {
    mockDesktop = signer === "desktop";
    mockStore.qrlStore.activeAccountSource =
      signer === "desktop" ? "seed" : signer;
    await show(<Transfer />);
    snapshot();
  },
);
it("Transfer without an account", async () => {
  mockStore.qrlStore.activeAccount.accountAddress = "";
  await show(<Transfer />);
  snapshot();
});
it("Transfer token form, contract and copied address", async () => {
  mockAsset = CONTRACT;
  await show(<Transfer />);
  await screen.findByText("10.0 EX");
  snapshot();
  await click("Copy");
  snapshot();
});
it("Transfer native scanner pending, success and invalid QR", async () => {
  mockNative = true;
  await show(<Transfer />);
  fireEvent.click(screen.getByTitle("Scan QR code"));
  snapshot();
  await act(async () => {
    mockNativeListener?.({ type: "QR_RESULT", payload: { address: mockTo } });
    await Promise.resolve();
  });
  snapshot();
  fireEvent.click(screen.getByTitle("Scan QR code"));
  await act(async () => {
    mockNativeListener?.({
      type: "QR_RESULT",
      payload: { address: "invalid" },
    });
    await Promise.resolve();
  });
  snapshot();
});
it.each(["", "0", "0.1234567890123456789"])(
  "Transfer amount validation: %s",
  async (amount) => {
    await show(<Transfer />);
    await fillTransfer(amount, "1");
    const form = document.querySelector("form");
    if (!form) throw new Error("Missing form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
    snapshot();
  },
);
it("Transfer missing asset and recipient validation", async () => {
  await show(<Transfer />);
  const form = document.querySelector("form");
  if (!form) throw new Error("Missing form");
  await act(async () => {
    fireEvent.submit(form);
    await Promise.resolve();
  });
  snapshot();
});
it.each([
  "missing seed",
  "credential",
  "unlock",
  "seed mismatch",
  "wallet changed",
  "recipient changed",
  "recipient invalid",
  "transaction error",
  "non-Error",
  "incorrect PIN",
  "PIN lockout",
])("Transfer seed failure: %s", async (failure) => {
  if (failure === "missing seed") mockStoredSeed = null;
  if (failure === "credential")
    mockDecrypt.mockRejectedValue(new DeviceCredentialUnavailableError());
  if (failure === "unlock")
    mockDecrypt.mockRejectedValue(new Error("Unable to decrypt"));
  if (failure === "seed mismatch") mockSender = mockTo;
  if (failure === "wallet changed") mockCurrentWallet = false;
  if (failure === "recipient changed") mockRevalidate = false;
  if (failure === "recipient invalid") {
    mockCapture = false;
    mockResolution.message = null;
  }
  if (failure === "transaction error")
    mockSend.mockRejectedValue(new Error("Node detail <verbatim>"));
  if (failure === "non-Error") mockSend.mockRejectedValue("Offline");
  if (failure === "incorrect PIN")
    mockDecrypt.mockRejectedValue(
      new PinVerificationError({
        isLocked: false,
        attemptsLeft: 1,
        remainingMs: 0,
      }),
    );
  if (failure === "PIN lockout")
    mockDecrypt.mockRejectedValue(
      new PinVerificationError({
        isLocked: true,
        attemptsLeft: 0,
        remainingMs: 60000,
      }),
    );
  await show(<Transfer />);
  await fillTransfer();
  const form = document.querySelector("form");
  if (!form) throw new Error("Missing form");
  await act(async () => {
    fireEvent.submit(form);
    await Promise.resolve();
  });
  snapshot();
});
it.each(["seed", "mobile", "desktop"] satisfies SendSigner[])(
  "Transfer token failure: %s",
  async (signer) => {
    mockAsset = CONTRACT;
    mockDesktop = signer === "desktop";
    mockStore.qrlStore.activeAccountSource =
      signer === "desktop" ? "seed" : signer;
    mockSend.mockRejectedValue(new Error("Signer detail"));
    await show(<Transfer />);
    await fillTransfer("1.234567", signer === "seed" ? "123456" : "");
    const form = document.querySelector("form");
    if (!form) throw new Error("Missing form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
    snapshot();
  },
);
it("Transfer submitting", async () => {
  mockStore.qrlStore.activeAccountSource = "mobile";
  mockSend.mockReturnValue(new Promise(() => undefined));
  await show(<Transfer />);
  await fillTransfer("1", "");
  await click("Send Quanta");
  snapshot();
});

it.each(["preparing", "pending", "rejected", "failed", "timeout"] as const)(
  "SendStatus: %s",
  async (state) => {
    await show(
      <SendStatus
        status={{ ...idle(), state, error: "Specific outcome" }}
        blockchain="TEST_NET"
        onBack={jest.fn()}
      />,
    );
    snapshot();
  },
);
it.each(["mobile", "desktop", "extension"] satisfies SendSigner[])(
  "SendStatus approval: %s",
  async (signer) => {
    await show(
      <SendStatus
        status={{
          ...idle(),
          state: "awaiting-approval",
          details: {
            from: FROM,
            to: mockTo,
            asset: "Quanta",
            amount: "1.234567",
            signer,
            blockchain: "TEST_NET",
          },
        }}
        blockchain="TEST_NET"
        onBack={jest.fn()}
      />,
    );
    snapshot();
  },
);
it("SendStatus broadcast and hash copied", async () => {
  await show(
    <SendStatus
      status={{ ...idle(), state: "pending", txHash: HASH }}
      blockchain="TEST_NET"
      onBack={jest.fn()}
    />,
  );
  snapshot();
  await click("Copy transaction hash");
  snapshot();
});
it.each([true, false])("Receipt with amount: %s", async (amount) => {
  await show(
    <TransactionSuccessful
      transactionReceipt={receipt}
      amount={amount ? "1.234567" : undefined}
      assetSymbol="EX"
      onDone={jest.fn()}
    />,
  );
  snapshot();
  await click("Copy transaction hash");
  snapshot();
  await click("Copy block hash");
  snapshot();
});
it("Receipt without effective gas price", async () => {
  const { effectiveGasPrice: _price, ...withoutPrice } = receipt;
  await show(
    <TransactionSuccessful
      transactionReceipt={withoutPrice}
      onDone={jest.fn()}
    />,
  );
  snapshot();
});
it.each(["empty", "loading", "success", "error", "invalid"])(
  "GasFeeNotice: %s",
  async (state) => {
    jest.useFakeTimers();
    if (state === "error")
      mockEstimate.mockRejectedValue(new Error("Estimate detail"));
    if (state === "invalid") mockEstimate.mockResolvedValue({ invalid: true });
    await show(
      <GasFeeNotice
        from={FROM}
        to={mockTo}
        value={state === "empty" ? "" : "1"}
        isSubmitting={false}
        feeLevel="medium"
        onFeeLevelChange={jest.fn()}
      />,
    );
    if (!["empty", "loading"].includes(state))
      await act(async () => {
        await jest.advanceTimersByTimeAsync(600);
      });
    snapshot();
  },
);

it.each(["empty", "loading", "unavailable", "failure", "501", "storage"])(
  "History: %s",
  async (state) => {
    if (state === "loading")
      mockPost.mockReturnValue(new Promise(() => undefined));
    if (state === "unavailable") mockHistoryNetwork = null;
    if (state === "failure") mockPost.mockRejectedValue(new Error("offline"));
    if (state === "501")
      mockPost.mockRejectedValue(
        Object.assign(new Error("unavailable"), { response: { status: 501 } }),
      );
    mockStorageUnavailable = state === "storage";
    await show(<TransactionHistory />);
    snapshot();
  },
);
it.each(["confirmed", "pending", "failed", "dropped", undefined] as const)(
  "History row and details: %s",
  async (state) => {
    const tx = row(state);
    if (state === "pending") {
      tx.BlockNumber = "";
      delete tx.PaidFees;
      tx.asset = "EX";
    }
    mockRows = [tx];
    await show(<TransactionHistory />);
    snapshot();
    await click("View");
    snapshot();
    await click("Close");
    snapshot();
  },
);
it("History incoming, sort directions, pagination, filter empty and loading more", async () => {
  mockPost.mockResolvedValue({
    data: {
      transactions: Array.from({ length: 5 }, (_, index) =>
        row("confirmed", index),
      ),
    },
  });
  await show(<TransactionHistory />);
  snapshot();
  for (const name of ["Sort by hash", "Sort by amount", "Sort by date"]) {
    act(() => {
      fireEvent.click(
        screen.getAllByRole("button", { name })[0] ?? document.body,
      );
    });
    snapshot();
    act(() => {
      fireEvent.click(
        screen.getAllByRole("button", { name })[0] ?? document.body,
      );
    });
    snapshot();
  }
  fireEvent.change(
    screen.getByPlaceholderText("Search loaded transactions..."),
    { target: { value: "missing" } },
  );
  snapshot();
  mockPost.mockReturnValue(new Promise(() => undefined));
  await click("Load More");
  snapshot();
});

it.each(["web", "native", "desktop"])("Accounts empty: %s", async (shell) => {
  mockNative = shell === "native";
  mockDesktop = shell === "desktop";
  mockStore.qrlStore.activeAccount.accountAddress = "";
  await show(<AccountList />);
  await screen.findByRole("link", { name: "Create a new account" });
  snapshot();
});
it.each(["seed", "extension", "mobile"])(
  "ActiveAccount: %s",
  async (signer) => {
    mockStore.qrlStore.activeAccountSource = signer;
    await show(<ActiveAccount />);
    snapshot();
  },
);
it("Accounts at wallet limit", async () => {
  mockWalletLimit = true;
  await show(<AccountList />);
  await screen.findByText("Wallet limit reached (10/10)");
  snapshot();
});
it.each([true, false])("OtherAccounts with active: %s", async (active) => {
  if (!active) mockStore.qrlStore.activeAccount.accountAddress = "";
  await show(<OtherAccounts />);
  snapshot();
});
it("OtherAccounts empty", async () => {
  mockStore.qrlStore.qrlAccounts.accounts = [];
  await show(<OtherAccounts />);
  snapshot();
});
it.each([true, false])("AccountId oneLine: %s", async (oneLine) => {
  await show(<AccountId account={FROM} oneLine={oneLine} />);
  snapshot();
  if (!oneLine) {
    await click("Show full");
    snapshot();
  }
});
it("AccountBalance and source badges", async () => {
  await show(
    <>
      <AccountBalance accountAddress={FROM} />
      <ExtensionBadge />
      <MobileBadge />
    </>,
  );
  snapshot();
});
it("Account copy tooltip, copied state and QR dialog", async () => {
  await show(<CopyAddressButton accountAddress={FROM} tooltipOpen />);
  snapshot();
  await click("Copy address");
  snapshot();
  await click("Show address QR code");
  snapshot();
});

it("Contacts empty and add dialog", async () => {
  await show(<AddressBook />);
  snapshot();
  await click("Add");
  snapshot();
});
it.each(["name", "address", "duplicate"])(
  "Contacts validation: %s",
  async (error) => {
    contacts();
    await show(<AddressBook />);
    await click("Add");
    if (error !== "name")
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Recipient" },
      });
    if (error === "duplicate")
      fireEvent.change(screen.getByLabelText("QRL address"), {
        target: { value: mockTo },
      });
    await click("Save");
    snapshot();
  },
);
it("Contacts populated, copied, rename and delete dialogs", async () => {
  contacts();
  await show(<AddressBook />);
  snapshot();
  fireEvent.click(screen.getByTitle("Copy address"));
  snapshot();
  fireEvent.click(screen.getByTitle("Rename"));
  snapshot();
  await click("Cancel");
  fireEvent.click(screen.getByTitle("Delete"));
  snapshot();
  await click("Delete");
  snapshot();
});
it.each(["empty", "saved", "offer", "saved-current", "closed"])(
  "Contact picker: %s",
  async (state) => {
    if (state !== "empty") contacts();
    await show(
      <AddressBookPicker
        open={state !== "closed"}
        currentAddress={
          state === "offer" ? FROM : state === "saved-current" ? mockTo : ""
        }
        onOpenChange={jest.fn()}
        onSelect={jest.fn()}
      />,
    );
    snapshot();
    if (state === "offer") {
      // The recipient can be saved elsewhere after this dialog rendered.
      localStorage.setItem(
        "qrl:addressBook:qip55:v2",
        JSON.stringify([
          { id: "new", name: "Existing", address: FROM, createdAt: 0 },
        ]),
      );
      fireEvent.change(screen.getByPlaceholderText("Name"), {
        target: { value: "Recipient" },
      });
      snapshot();
    }
  },
);
it.each([
  ["idle", null],
  ["pending", "Resolving alice.qrl on QRL Testnet."],
  ["success", "alice.qrl resolved successfully."],
  ["success", "Recipient address verified."],
  ["error", "Recipient is not a valid QRL address."],
  ["error", "QRNS recipient names must end in .qrl."],
  ["error", "No native QRL address is set for alice.qrl."],
  ["unavailable", "QRNS is not configured for QRL Testnet."],
  ["error", "Service detail <verbatim>"],
] satisfies [QrnsRecipientState["status"], string | null][])(
  "RecipientResolutionStatus: %s %s",
  async (status, message) => {
    await show(
      <RecipientResolutionStatus
        resolution={{ ...mockResolution, status, message }}
      />,
    );
    snapshot();
  },
);

it("History delayed error snapshot", async () => {
  const request = deferred<{ data: unknown }>();
  mockPost.mockReturnValue(request.promise);
  await show(<TransactionHistory />);
  snapshot();
  await act(async () => {
    request.reject(new Error("offline"));
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.getByRole("alert").textContent).toBe(
      "Unable to load transaction history. Please try again.",
    );
  });
  snapshot();
});

it.each([
  "Transaction failed. Please try again.",
  "Transaction reverted: Execution detail <verbatim>",
  "Transaction execution failed. The transfer was reverted.",
  "The approval request timed out. Check your signer and History before retrying.",
  "The approval request was cancelled.",
  "The transaction was declined or the approval request was closed in your signer.",
  "Confirmation is unavailable: Node detail Check History or the explorer before sending again.",
  "Still waiting for confirmation after 5 minutes. Check History or the explorer before sending again.",
])("SendStatus service outcome: %s", async (error) => {
  await show(
    <SendStatus
      status={{ ...idle(), state: "timeout", txHash: HASH, error }}
      blockchain="TEST_NET"
      onBack={jest.fn()}
    />,
  );
  snapshot();
});
it.each([
  "Recipient is not a supported QNS name.",
  "QNS hashing accepts only ASCII input",
  "Invalid QNS character",
  'Empty label in "alice..qrl"',
  "QNS names may contain only ASCII letters, digits, hyphens, and dots",
  'Reserved double-hyphen label in "ab--cd.qrl"',
  "Invalid QNS label",
  "QRNS has no provider for the selected network.",
  "QRNS is unavailable until a wallet network is selected.",
  "QRNS configuration for Example network is incomplete or invalid.",
  "Unable to resolve alice.qrl.",
  "QRNS is unavailable because the RPC chain does not match Example network.",
  "QRNS is unavailable because the RPC genesis does not match Example network.",
  "QRNS is unavailable because its registry is not deployed on Example network.",
  "QRNS RPC returned HTTP 503",
  "QRNS RPC returned an invalid response",
  "QRNS RPC response has no result",
  "QRNS RPC request timed out",
  "QRNS returned a malformed 64-byte address",
  "QRNS returned an invalid QIP-55 address",
])("RecipientResolutionStatus diagnostic: %s", async (message) => {
  await show(
    <RecipientResolutionStatus
      resolution={{
        ...mockResolution,
        status: "error",
        address: null,
        message,
      }}
    />,
  );
  snapshot();
});
it.each([false, true])(
  "Transfer disconnected provider (token=%s)",
  async (token) => {
    if (token) mockAsset = CONTRACT;
    Object.defineProperty(mockStore.qrlStore, "qrlInstance", { value: null });
    await show(<Transfer />);
    await fillTransfer();
    const form = document.querySelector("form");
    if (!form) throw new Error("Missing form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
    snapshot();
  },
);
it("Transfer token seed mismatch", async () => {
  mockAsset = CONTRACT;
  mockSender = mockTo;
  await show(<Transfer />);
  await fillTransfer();
  const form = document.querySelector("form");
  if (!form) throw new Error("Missing form");
  await act(async () => {
    fireEvent.submit(form);
    await Promise.resolve();
  });
  snapshot();
});
it("Transfer remote non-Error fallback", async () => {
  mockStore.qrlStore.activeAccountSource = "mobile";
  mockSend.mockRejectedValue(42);
  await show(<Transfer />);
  await fillTransfer("1", "");
  await click("Send Quanta");
  await screen.findByText("Transfer failed: Unexpected transfer error.");
  snapshot();
});
it("GasFeeNotice without a provider", async () => {
  jest.useFakeTimers();
  Object.defineProperty(mockStore.qrlStore, "qrlInstance", { value: null });
  await show(
    <GasFeeNotice
      from={FROM}
      to={mockTo}
      value="1"
      isSubmitting
      feeLevel="high"
      onFeeLevelChange={jest.fn()}
    />,
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });
  snapshot();
});
it("Contacts picker duplicate saved after the last render", async () => {
  await show(
    <AddressBookPicker
      open
      currentAddress={FROM}
      onOpenChange={jest.fn()}
      onSelect={jest.fn()}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText("Name"), {
    target: { value: "Recipient" },
  });
  localStorage.setItem(
    "qrl:addressBook:qip55:v2",
    JSON.stringify([
      { id: "new", name: "Existing", address: FROM, createdAt: 0 },
    ]),
  );
  await click("Save");
  snapshot();
});
it("AccountList with all account cards", async () => {
  await show(<AccountList />);
  await screen.findByRole("link", { name: "Create a new account" });
  snapshot();
});

it.each([
  ["Account List", <AccountList />],
  ["Transfer", <Transfer />],
  ["Address Book", <AddressBook />],
  ["Transaction History", <TransactionHistory />],
  [
    "Transaction Completed",
    <TransactionSuccessful transactionReceipt={receipt} onDone={jest.fn()} />,
  ],
] satisfies [string, ReactElement][])(
  "SEO copy: %s",
  async (title, element) => {
    await show(element);
    await waitFor(() => {
      expect(document.title).toBe(`${title} | MyQRLWallet`);
      expect(
        document.querySelector('meta[name="title"]')?.getAttribute("content"),
      ).toBe(`${title} | MyQRLWallet`);
      expect(
        document.querySelector('meta[name="twitter:image:alt"]'),
      ).not.toBeNull();
    });
    expect(
      [...document.head.querySelectorAll("title, meta[data-rh]")].map(
        (element) => ({
          tag: element.tagName,
          name:
            element.getAttribute("name") ?? element.getAttribute("property"),
          content: element.getAttribute("content") ?? element.textContent,
        }),
      ),
    ).toMatchSnapshot();
  },
);

it("Account QR image copied state", async () => {
  const originalEncoder = globalThis.TextEncoder;
  Object.defineProperty(globalThis, "TextEncoder", {
    configurable: true,
    value: TextEncoder,
  });
  const originalContext = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    "getContext",
  );
  const originalBlob = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    "toBlob",
  );
  if (!originalContext || !originalBlob)
    throw new Error("Missing canvas fixture methods");
  const originalClipboard = navigator.clipboard;
  const originalItem = globalThis.ClipboardItem;
  const imageSpy = jest.spyOn(globalThis, "Image").mockImplementation(() => {
    const img = document.createElement("img");
    Object.defineProperty(img, "src", {
      set: () => {
        queueMicrotask(() => img.dispatchEvent(new Event("load")));
      },
    });
    return img;
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ fillStyle: "", fillRect: jest.fn(), drawImage: jest.fn() }),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
    configurable: true,
    value: (callback: BlobCallback) => {
      callback(new Blob(["fixture"], { type: "image/png" }));
    },
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write: () => Promise.resolve() },
  });
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: class {
      constructor(readonly items: Record<string, Blob>) {}
    },
  });
  try {
    await show(<CopyAddressButton accountAddress={FROM} />);
    await click("Show address QR code");
    await click("Copy QR");
    await screen.findByRole("button", { name: "Copied!" });
    snapshot();
  } finally {
    imageSpy.mockRestore();
    Object.defineProperty(globalThis, "TextEncoder", {
      value: originalEncoder,
    });
    Object.defineProperty(
      HTMLCanvasElement.prototype,
      "getContext",
      originalContext,
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", originalBlob);
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard });
    Object.defineProperty(globalThis, "ClipboardItem", { value: originalItem });
  }
});
