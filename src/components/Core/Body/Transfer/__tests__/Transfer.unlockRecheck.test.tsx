/** @jest-environment jsdom */
// The PIN unlock takes a second or two. An account, network or provider
// change while it runs must stop the send before anything is signed or
// broadcast, and the PIN accounting must stay exactly as it was.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { configure, observable, runInAction } from "mobx";
import type { TransactionStatus } from "@/stores/qrlStore";
import type { ApprovedFee } from "@/utils/web3/feePolicy";
import { decryptStoredSeedWithPin } from "@/utils/crypto";
import {
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from "@/utils/crypto/pinAttemptTracker";
import { deferred } from "@/test-utils/deferred";
import { useEffect } from "react";
import Transfer from "../Transfer";

configure({ enforceActions: "never" });

const FROM = `Q${"1".repeat(128)}`;
const OTHER = `Q${"4".repeat(128)}`;
const TO = `Q${"2".repeat(128)}`;
const CONTRACT = `Q${"3".repeat(128)}`;
let mockAsset = "native";
let mockStore: ReturnType<typeof fixture>;

jest.mock("@/utils/reportError", () => ({ reportError: jest.fn() }));
jest.mock("react-router", () => ({
  useLocation: () => ({ state: null }),
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams({ asset: mockAsset }), jest.fn()],
}));
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("@/utils", () => ({
  log: jest.fn(),
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
jest.mock("@/router/router", () => ({
  ROUTES: { HOME: "/", IMPORT_ACCOUNT: "/import" },
}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET: { url: "https://rpc.example", explorer: "https://explorer.example" },
    MAIN_NET: { url: "https://rpc.example", explorer: "https://explorer.example" },
  },
  getExplorerAddressUrl: () => "https://explorer.example/address",
  getExplorerTxUrl: (hash: string) => `https://explorer.example/tx/${hash}`,
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getBlockChain: () => Promise.resolve("TEST_NET"),
    getEncryptedSeed: () => Promise.resolve("fixture"),
  },
}));
jest.mock("@/utils/crypto", () => ({
  DeviceCredentialUnavailableError: class extends Error {},
  decryptStoredSeedWithPin: jest.fn(),
  getAddressFromMnemonicAsync: () => Promise.resolve(`Q${"1".repeat(128)}`),
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
// the send.
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: { captureGeneration: () => 0, isCurrent: () => true },
}));
jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(() => Promise.resolve(true)),
  openExternalUrl: jest.fn(),
  isInNativeApp: () => false,
  requestQRScan: jest.fn(),
  subscribeToNativeMessages: () => jest.fn(),
  triggerHaptic: jest.fn(),
}));
jest.mock("@/utils/web3", () => ({
  fetchBalance: () => Promise.resolve(10000000n),
  isValidQrlAddress: () => true,
}));
jest.mock("@/hooks/useNetworkQrnsRecipient", () => ({
  useNetworkQrnsRecipient: () => ({
    status: "success",
    address: `Q${"2".repeat(128)}`,
    bindingKey: "recipient",
    captureSubmission: (input: string) => ({
      input,
      address: `Q${"2".repeat(128)}`,
      bindingKey: "recipient",
    }),
    revalidateSubmission: () => `Q${"2".repeat(128)}`,
  }),
}));
function MockFee({ onQuote }: { onQuote: (fee: ApprovedFee) => void }) {
  useEffect(() => {
    onQuote({
      gasLimit: 21000n,
      quote: { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
    });
  }, [onQuote]);
  return null;
}
jest.mock("../GasFeeNotice/GasFeeNotice", () => ({ GasFeeNotice: MockFee }));
jest.mock("../../AddressBook/AddressBookPicker", () => ({
  AddressBookPicker: () => null,
}));
jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));
jest.mock("@/components/UI/PinInput/PinInput", () => ({
  PinInput: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label="PIN"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  ),
}));

// Distinct contents: the store's struct comparer treats equal ones as one.
let providerCount = 0;
class FakeProvider {
  readonly id = ++providerCount;
}

function idle(): TransactionStatus {
  return { state: "idle", txHash: null, receipt: null, error: null };
}
function fixture() {
  const qrlStore = observable(
    {
      activeAccount: { accountAddress: FROM },
      activeAccountSource: "seed",
      qrlConnection: { blockchain: "TEST_NET" },
      qrlInstance: new FakeProvider(),
      getAccountBalance: () => "10",
      estimateNativeTransferFee: () => Promise.resolve("0.001"),
      transactionStatus: idle(),
      resetTransactionStatus: () => {},
      signAndSendTransaction: jest.fn<Promise<boolean>, unknown[]>(() =>
        Promise.resolve(true),
      ),
    },
    {
      activeAccount: observable.struct,
      qrlConnection: observable.struct,
      qrlInstance: observable.struct,
      signAndSendTransaction: false,
    },
  );
  const tokenStore = {
    visibleTokenList: [
      { address: CONTRACT, name: "Token", symbol: "TOK", decimals: 6, amount: "10" },
    ],
    sendToken: jest.fn<Promise<boolean>, unknown[]>(() => Promise.resolve(true)),
  };
  return { qrlStore, tokenStore };
}

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: MockResizeObserver,
  });
  Object.defineProperty(window, "scrollTo", { configurable: true, value: jest.fn() });
  mockStore = fixture();
});
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

async function startSend(token: boolean) {
  mockAsset = token ? CONTRACT : "native";
  const unlock = deferred<{ mnemonic: string; hexSeed: string }>();
  jest.mocked(decryptStoredSeedWithPin).mockReturnValue(unlock.promise);
  render(<Transfer />);
  await act(() => {
    fireEvent.change(screen.getByPlaceholderText("QRL address or QNS name"), {
      target: { value: TO },
    });
    fireEvent.change(screen.getByPlaceholderText("Enter amount"), {
      target: { value: "1.5" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
    return Promise.resolve();
  });
  const submit = screen.getByRole("button", {
    name: token ? "Send TOK" : "Send Quanta",
  });
  await waitFor(() => {
    expect(submit.hasAttribute("disabled")).toBe(false);
  });
  await act(() => {
    fireEvent.click(submit);
    return Promise.resolve();
  });
  await waitFor(() => {
    expect(decryptStoredSeedWithPin).toHaveBeenCalledTimes(1);
  });
  return unlock;
}

const STALE_CHANGES: [string, () => void][] = [
  ["account", () => { mockStore.qrlStore.activeAccount = { accountAddress: OTHER }; }],
  ["network", () => { mockStore.qrlStore.qrlConnection = { blockchain: "MAIN_NET" }; }],
];

const CHANGES: [string, () => void][] = [
  ["account", () => { mockStore.qrlStore.activeAccount = { accountAddress: OTHER }; }],
  ["network", () => { mockStore.qrlStore.qrlConnection = { blockchain: "MAIN_NET" }; }],
  ["provider", () => { mockStore.qrlStore.qrlInstance = new FakeProvider(); }],
  ["source", () => { mockStore.qrlStore.activeAccountSource = "mobile"; }],
];

describe.each([
  ["native send", false],
  ["token send", true],
])("%s unlock re-check", (_label, token) => {
  const sent = () =>
    token ? mockStore.tokenStore.sendToken : mockStore.qrlStore.signAndSendTransaction;

  it.each(CHANGES)(
    "signs nothing when the %s changes during the unlock",
    async (name, change) => {
      const unlock = await startSend(token);
      act(() => { runInAction(change); });
      await act(async () => {
        unlock.resolve({ mnemonic: "fixture", hexSeed: "00" });
        await Promise.resolve();
      });
      // A source change swaps the PIN field out, which also carries the message.
      if (name !== "source") {
        expect(
          await screen.findByText(
            `${token ? "Transfer failed" : "Transaction failed"}: Wallet changed while preparing the transaction`,
          ),
        ).toBeTruthy();
      }
      await act(() => Promise.resolve());
      expect(sent()).not.toHaveBeenCalled();
      expect(recordFailedAttempt).not.toHaveBeenCalled();
      expect(recordSuccessfulAttempt).toHaveBeenCalledTimes(1);
    },
  );

  it.each(STALE_CHANGES)(
    "refuses a tap made on a render that predates the %s change",
    async (_name, change) => {
      mockAsset = token ? CONTRACT : "native";
      jest.mocked(decryptStoredSeedWithPin).mockResolvedValue({ mnemonic: "fixture", hexSeed: "00" });
      render(<Transfer />);
      await act(() => {
        fireEvent.change(screen.getByPlaceholderText("QRL address or QNS name"), { target: { value: TO } });
        fireEvent.change(screen.getByPlaceholderText("Enter amount"), { target: { value: "1.5" } });
        fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
        return Promise.resolve();
      });
      const submit = screen.getByRole("button", { name: token ? "Send TOK" : "Send Quanta" });
      await waitFor(() => { expect(submit.hasAttribute("disabled")).toBe(false); });
      // One batch: React has not re-rendered when the tap handler runs.
      await act(() => {
        runInAction(change);
        fireEvent.click(submit);
        return Promise.resolve();
      });
      expect(
        await screen.findByText(
          `${token ? "Transfer failed" : "Transaction failed"}: Wallet changed while preparing the transaction`,
        ),
      ).toBeTruthy();
      expect(decryptStoredSeedWithPin).not.toHaveBeenCalled();
      expect(sent()).not.toHaveBeenCalled();
    },
  );

  it("sends exactly once when nothing changes", async () => {
    const unlock = await startSend(token);
    await act(async () => {
      unlock.resolve({ mnemonic: "fixture", hexSeed: "00" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(sent()).toHaveBeenCalledTimes(1);
    });
    expect(recordSuccessfulAttempt).toHaveBeenCalledTimes(1);
    expect(recordFailedAttempt).not.toHaveBeenCalled();
  });
});
