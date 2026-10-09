/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { observable, runInAction } from "mobx";
import { useEffect } from "react";
import type { TransactionStatus } from "@/stores/qrlStore";
import type { SendSigner } from "@/utils/sendStatus";
import type { ApprovedFee } from "@/utils/web3/feePolicy";
import { copyToClipboard } from "@/utils/nativeApp";
import Transfer from "../Transfer";
import { SendStatus } from "../SendStatus";

const FROM = `Q${"1".repeat(128)}`;
const TO = `Q${"2".repeat(128)}`;
const CONTRACT = `Q${"3".repeat(128)}`;
const HASH = `0x${"a".repeat(64)}`;
let mockDesktop = false;
let mockAsset = "native";
let mockStore: ReturnType<typeof fixture>;

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
    TEST_NET: {
      url: "https://rpc.example",
      explorer: "https://explorer.example",
    },
  },
  getExplorerAddressUrl: () => "https://explorer.example/address",
  getExplorerTxUrl: (hash: string) => `https://explorer.example/tx/${hash}`,
}));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getBlockChain: async () => "TEST_NET",
    getEncryptedSeed: async () => "fixture",
  },
}));
jest.mock("@/utils/crypto", () => ({
  DeviceCredentialUnavailableError: class extends Error {},
  decryptStoredSeedWithPin: async () => ({ mnemonic: "fixture" }),
  getAddressFromMnemonicAsync: async () => `Q${"1".repeat(128)}`,
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: { captureGeneration: () => 0, isCurrent: () => true },
}));
jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(async () => true),
  openExternalUrl: jest.fn(),
  isInNativeApp: () => false,
  requestQRScan: jest.fn(),
  subscribeToNativeMessages: () => jest.fn(),
  triggerHaptic: jest.fn(),
}));
jest.mock("@/utils/web3", () => ({
  fetchBalance: async () => 10000000n,
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
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

function idle(): TransactionStatus {
  return {
    state: "idle",
    txHash: null,
    receipt: null,
    error: null,
  };
}
function fixture(signer: SendSigner, token: boolean) {
  mockDesktop = signer === "desktop";
  mockAsset = token ? CONTRACT : "native";
  const qrlStore = observable(
    {
      activeAccount: { accountAddress: FROM },
      activeAccountSource: signer === "desktop" ? "seed" : signer,
      qrlConnection: { blockchain: "TEST_NET" },
      qrlInstance: {},
      getAccountBalance: () => "10",
      estimateNativeTransferFee: async () => "0.001",
      transactionStatus: idle(),
      resetTransactionStatus: () => {
        runInAction(() => {
          qrlStore.transactionStatus = idle();
        });
      },
      signAndSendTransaction: jest.fn<Promise<boolean>, unknown[]>(),
      sendTransactionViaProvider: jest.fn<Promise<boolean>, unknown[]>(),
    },
    { signAndSendTransaction: false, sendTransactionViaProvider: false },
  );
  const tokenStore = {
    visibleTokenList: [
      {
        address: CONTRACT,
        name: "Token",
        symbol: "TOK",
        decimals: 6,
        amount: "10",
      },
    ],
    sendToken: jest.fn<Promise<boolean>, unknown[]>(),
  };
  const fail = async () => {
    runInAction(() => {
      qrlStore.transactionStatus = {
        ...idle(),
        state: signer === "seed" ? "failed" : "rejected",
        error:
          signer === "seed"
            ? "Node rejected the transaction"
            : "The approval request was cancelled.",
      };
    });
    return false;
  };
  qrlStore.signAndSendTransaction.mockImplementation(fail);
  qrlStore.sendTransactionViaProvider.mockImplementation(fail);
  tokenStore.sendToken.mockImplementation(fail);
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
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: jest.fn(),
  });
  mockStore = fixture("mobile", false);
});
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it.each<SendSigner>(["extension", "mobile", "desktop"])(
  "names the %s approval surface and reviewed values",
  (signer) => {
    const state: TransactionStatus = {
      ...idle(),
      state: "awaiting-approval",
      details: {
        from: FROM,
        to: TO,
        amount: "1.234567",
        asset: "Quanta",
        signer,
        blockchain: "TEST_NET",
      },
    };
    render(
      <SendStatus status={state} blockchain="TEST_NET" onBack={jest.fn()} />,
    );
    expect(screen.getByRole("heading").textContent).toBe(
      "Waiting for approval",
    );
    expect(
      screen.getByText(
        signer === "extension"
          ? "Approve this transaction in the MyQRLWallet extension"
          : signer === "mobile"
            ? "Approve this transaction in the MyQRLWallet app on your phone"
            : "Approve this transaction in the MyQRLWallet desktop signer",
      ),
    ).toBeTruthy();
    expect(screen.getByText("1.234567 Quanta")).toBeTruthy();
    expect(screen.getByLabelText(`QRL address ${TO}`)).toBeTruthy();
    expect(
      screen.queryByText(/submitted|broadcast|included in a block/i),
    ).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  },
);

it("shows and copies the broadcast hash and links to the full explorer URL", async () => {
  render(
    <SendStatus
      status={{ ...idle(), state: "pending", txHash: HASH }}
      blockchain="TEST_NET"
      onBack={jest.fn()}
    />,
  );
  expect(screen.getByRole("heading").textContent).toBe("Signed and sent");
  expect(screen.getByText(/waiting to be included in a block/)).toBeTruthy();
  expect(
    screen.getByText(`${HASH.slice(0, 10)}...${HASH.slice(-8)}`),
  ).toBeTruthy();
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    `https://explorer.example/tx/${HASH}`,
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Copy transaction hash" }),
    );
  });
  expect(copyToClipboard).toHaveBeenCalledWith(HASH);
  expect(
    screen.getByRole("button", { name: "Transaction hash copied" }),
  ).toBeTruthy();
});

it.each([false, true])(
  "keeps form values after every signer's unsuccessful send (token=%s)",
  async (token) => {
    for (const signer of ["seed", "extension", "mobile", "desktop"] as const) {
      mockStore = fixture(signer, token);
      render(<Transfer />);
      await act(async () => {
        fireEvent.change(
          screen.getByPlaceholderText("QRL address or QNS name"),
          { target: { value: TO } },
        );
        fireEvent.change(screen.getByPlaceholderText("Enter amount"), {
          target: { value: "1.234567" },
        });
        if (signer === "seed")
          fireEvent.change(screen.getByLabelText("PIN"), {
            target: { value: "123456" },
          });
      });
      const submit = screen.getByRole("button", {
        name: token ? "Send TOK" : "Send Quanta",
      });
      await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false));
      await act(async () => {
        fireEvent.click(submit);
      });
      expect(screen.getByRole("heading").textContent).toBe(
        signer === "seed" ? "Transaction failed" : "Transaction rejected",
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to form" }));
      });
      expect(screen.getByDisplayValue(TO)).toBeTruthy();
      expect(screen.getByDisplayValue("1.234567")).toBeTruthy();
      const send = token
        ? mockStore.tokenStore.sendToken
        : signer === "mobile" || signer === "extension"
          ? mockStore.qrlStore.sendTransactionViaProvider
          : mockStore.qrlStore.signAndSendTransaction;
      expect(send).toHaveBeenCalledTimes(1);
      cleanup();
    }
  },
);

it("renders receipt confirmation with the block number and submitted token amount", () => {
  mockStore.qrlStore.transactionStatus = {
    ...idle(),
    state: "confirmed",
    txHash: HASH,
    receipt: {
      transactionHash: HASH,
      blockHash: `0x${"b".repeat(64)}`,
      blockNumber: 42n,
      gasUsed: 21000n,
      effectiveGasPrice: 100n,
      status: 1n,
    },
    details: {
      from: FROM,
      to: TO,
      amount: "1.234567",
      asset: "TOK",
      signer: "mobile",
      blockchain: "TEST_NET",
    },
  };
  render(<Transfer />);
  expect(screen.getByRole("heading").textContent).toBe("Transaction Completed");
  expect(screen.getByText("Block number")).toBeTruthy();
  expect(screen.getByRole("link", { name: "42" }).getAttribute("href")).toBe(
    "https://explorer.example/block/42",
  );
  expect(screen.getByText(/TOK/)).toBeTruthy();
});

it.each(["rejected", "failed", "timeout"] as const)(
  "shows the %s reason and a return action",
  (state) => {
    const onBack = jest.fn();
    render(
      <SendStatus
        status={{
          ...idle(),
          state,
          error: "Specific outcome",
          txHash: state === "timeout" ? HASH : null,
        }}
        blockchain="TEST_NET"
        onBack={onBack}
      />,
    );
    expect(screen.getByText("Specific outcome")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: state === "timeout" ? "Done" : "Back to form",
      }),
    );
    expect(onBack).toHaveBeenCalledTimes(1);
  },
);

it("keeps a shared pending status without a hash in preparation", () => {
  render(
    <SendStatus
      status={{ ...idle(), state: "pending" }}
      blockchain="TEST_NET"
      onBack={jest.fn()}
    />,
  );
  expect(screen.getByRole("heading").textContent).toBe("Preparing transaction");
  expect(screen.queryByText(/signed and broadcast/i)).toBeNull();
  expect(screen.queryByRole("button", { name: "Back to form" })).toBeNull();
});

describe.each([false, true])("returning during a send (token=%s)", (token) => {
  it.each(["awaiting-approval", "pending"] as const)(
    "keeps form values when leaving %s",
    async (state) => {
      mockStore = fixture("extension", token);
      const send = token
        ? mockStore.tokenStore.sendToken
        : mockStore.qrlStore.sendTransactionViaProvider;
      send.mockImplementation(() => {
        runInAction(() => {
          mockStore.qrlStore.transactionStatus = {
            ...idle(),
            state,
            txHash: state === "pending" ? HASH : null,
          };
        });
        return new Promise<boolean>(() => undefined);
      });
      render(<Transfer />);
      await act(async () => {
        fireEvent.change(
          screen.getByPlaceholderText("QRL address or QNS name"),
          {
            target: { value: TO },
          },
        );
        fireEvent.change(screen.getByPlaceholderText("Enter amount"), {
          target: { value: "1.234567" },
        });
      });
      const submit = screen.getByRole("button", {
        name: token ? "Send TOK" : "Send Quanta",
      });
      await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false));
      await act(async () => {
        fireEvent.click(submit);
      });
      expect(screen.getByRole("heading").textContent).toBe(
        state === "pending" ? "Signed and sent" : "Waiting for approval",
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to form" }));
      });
      expect(mockStore.qrlStore.transactionStatus.state).toBe("idle");
      expect(screen.getByDisplayValue(TO)).toBeTruthy();
      expect(screen.getByDisplayValue("1.234567")).toBeTruthy();
      expect(
        screen.getByDisplayValue("1.234567").hasAttribute("disabled"),
      ).toBe(false);
      expect(
        screen
          .getByRole("button", { name: token ? "Send TOK" : "Send Quanta" })
          .hasAttribute("disabled"),
      ).toBe(false);
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
});

it("clears the form when Done closes an unconfirmed broadcast", async () => {
  render(<Transfer />);
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText("Enter amount"), {
      target: { value: "1.234567" },
    });
    runInAction(() => {
      mockStore.qrlStore.transactionStatus = {
        ...idle(),
        state: "timeout",
        txHash: HASH,
      };
    });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
  });
  expect(screen.queryByDisplayValue("1.234567")).toBeNull();
});
