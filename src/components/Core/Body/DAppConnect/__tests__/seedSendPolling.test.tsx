/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import Web3, { utils } from "@theqrl/web3";
import { configure } from "mobx";
import { TextEncoder } from "node:util";
import type { ReactNode } from "react";
import QrlStore from "@/stores/qrlStore";
import { transactionHistoryStore } from "@/stores/transactionHistoryStore";
import { isRecord } from "@/utils/guards";
import { FEE_NOT_SHOWN } from "@/utils/web3/feePolicy";
import {
  QRL_TX_POLLING_CONFIG,
  SEND_TX_POLLING_CONFIG,
} from "@/utils/web3/txPolling";
import DAppApprovalModal from "../DAppApprovalModal";

const seedHash = `0x${"a".repeat(64)}`;
const dappHash = `0x${"b".repeat(64)}`;
const to = `Q${"2".repeat(128)}`;
let mockHexSeed = "";
let mockQrlStore: QrlStore;
const mockDappStore = {
  currentApproval: {
    id: "approval",
    sessionId: "session",
    method: "qrl_sendTransaction",
    params: new Array<Record<string, unknown>>(),
    dappInfo: { name: "Test dApp", url: "https://dapp.example" },
  },
  approvalModalOpen: true,
  txProgress: "idle",
  isCurrentApproval: () => true,
  setTxProgressForApproval: jest.fn(),
  sendApprovalResultById: jest.fn(),
  sendRejectionResultById: jest.fn(),
  rejectRequestById: jest.fn(),
};

jest.mock("@/stores/store", () => ({
  useStore: () => ({ qrlStore: mockQrlStore, dappConnectStore: mockDappStore }),
}));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: {},
  EXPLORER_BASE: "",
  getExplorerTxUrl: () => "https://explorer.example/tx",
}));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/utils", () => ({ log: jest.fn(), cn: () => "" }));
jest.mock("@/utils/crypto", () => ({
  deriveHexSeedAsync: async () => mockHexSeed,
  decryptStoredSeedWithPin: async () => ({ hexSeed: mockHexSeed }),
  DeviceCredentialUnavailableError: class extends Error {},
}));
jest.mock("@/utils/signing", () => ({}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/desktop/walletHydration", () => ({}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: { getAccountList: async () => [] },
}));
jest.mock("@/utils/storage/storage", () => ({
  __esModule: true,
  default: {
    getBlockChain: async () => "TEST_NET",
    getEncryptedSeed: async () => "encrypted-fixture",
  },
}));
jest.mock("@/utils/web3", () => ({
  getQrlWeb3: async () =>
    jest.requireActual<typeof import("@theqrl/web3")>("@theqrl/web3"),
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: { captureGeneration: () => 0, isCurrent: () => true },
}));
jest.mock("@/utils/nativeApp", () => ({
  getNativeInjectedPin: () => "123456",
  isIOSNativeApp: () => false,
}));
jest.mock("@/hooks/useHasNativeInjectedPin", () => ({
  useHasNativeInjectedPin: () => true,
}));
jest.mock("@/utils/formatting", () => ({ formatQuantaValue: () => "0" }));
jest.mock("@/components/UI/QrlAddress", () => ({ QrlAddress: () => null }));
jest.mock("@/components/UI/Dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogContent: ({ children }: { children: ReactNode }) => children,
}));

const originalTextEncoder = Object.getOwnPropertyDescriptor(
  globalThis,
  "TextEncoder",
);
beforeAll(() => {
  Object.defineProperty(globalThis, "TextEncoder", {
    configurable: true,
    value: TextEncoder,
  });
});
afterAll(() => {
  if (originalTextEncoder) {
    Object.defineProperty(globalThis, "TextEncoder", originalTextEncoder);
  } else {
    Reflect.deleteProperty(globalThis, "TextEncoder");
  }
});

beforeEach(() => {
  configure({ enforceActions: "never" });
  jest.useFakeTimers();
  jest.clearAllMocks();
  localStorage.clear();
  transactionHistoryStore.clear();
  jest.spyOn(QrlStore.prototype, "initializeBlockchain").mockResolvedValue();
  jest.spyOn(QrlStore.prototype, "fetchAccounts").mockResolvedValue();
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("keeps shared polling unchanged after a seed send and uses it for a later dApp approval", async () => {
  let broadcasts = 0;
  const receiptPolls: { hash: string; time: number }[] = [];
  const request = jest.fn(async (payload: unknown) => {
    const rpc = isRecord(payload) ? payload : {};
    const method = rpc["method"];
    if (typeof method !== "string") {
      throw new Error("Invalid RPC request");
    }
    let result: unknown;
    switch (method) {
      case "qrl_getTransactionCount":
        result = "0x0";
        break;
      case "qrl_getBlockByNumber":
        result = { baseFeePerGas: "0x64" };
        break;
      case "qrl_gasPrice":
        result = "0x65";
        break;
      case "qrl_maxPriorityFeePerGas":
        result = "0x1";
        break;
      case "qrl_estimateGas":
        result = "0x5208";
        break;
      case "qrl_chainId":
      case "net_version":
      case "qrl_blockNumber":
        result = "0x1";
        break;
      case "qrl_call":
        result = "0x";
        break;
      case "qrl_sendRawTransaction":
        broadcasts += 1;
        result = broadcasts === 1 ? seedHash : dappHash;
        break;
      case "qrl_getTransactionReceipt": {
        const params: unknown = rpc["params"];
        if (Array.isArray(params) && typeof params[0] === "string") {
          receiptPolls.push({ hash: params[0], time: Date.now() });
          result = null;
          break;
        }
        throw new Error("Invalid receipt request");
      }
      default:
        throw new Error(`Unexpected RPC method: ${method}`);
    }
    return { jsonrpc: "2.0", id: rpc["id"], result };
  });
  const { qrl: shared } = new Web3({
    provider: { request, supportsSubscriptions: () => false },
    config: QRL_TX_POLLING_CONFIG,
  });
  const sharedConfig = { ...shared.getContextObject().config };
  expect(sharedConfig).toMatchObject(QRL_TX_POLLING_CONFIG);
  const account = shared.accounts.create();
  mockHexSeed = account.seed;
  mockQrlStore = new QrlStore();
  mockQrlStore._Web3 = Web3;
  mockQrlStore._utils = utils;
  mockQrlStore.qrlInstance = shared;
  mockQrlStore.qrlConnection.blockchain = "TEST_NET";
  mockQrlStore.activeAccount.accountAddress = account.address;
  const sign = jest.spyOn(shared.accounts, "signTransaction");
  const sharedSend = jest.spyOn(shared, "sendSignedTransaction");

  await mockQrlStore.signAndSendTransaction(
    account.address,
    to,
    "1",
    "fixture mnemonic",
    "medium",
    FEE_NOT_SHOWN,
  );
  await jest.advanceTimersByTimeAsync(1);
  expect(mockQrlStore.transactionStatus.state).toBe("pending");
  expect(mockQrlStore.qrlInstance).toBe(shared);
  expect(shared.getContextObject().config).toEqual(sharedConfig);
  expect(sharedSend).not.toHaveBeenCalled();
  expect(sign).toHaveBeenCalledTimes(1);
  expect(transactionHistoryStore.getSnapshot().entries).toMatchObject([
    {
      hash: seedHash,
      from: account.address,
      to,
      amount: "1",
      state: "pending",
    },
  ]);

  await jest.advanceTimersByTimeAsync(
    SEND_TX_POLLING_CONFIG.transactionPollingInterval,
  );
  const seedPolls = receiptPolls.filter(({ hash }) => hash === seedHash);
  expect(seedPolls).toHaveLength(2);
  const seedStart = seedPolls[0]?.time;
  if (seedStart === undefined)
    throw new Error("Seed receipt polling did not start");
  expect(seedPolls[1]?.time).toBe(
    seedStart + SEND_TX_POLLING_CONFIG.transactionPollingInterval,
  );

  mockDappStore.currentApproval.params = [
    { from: account.address, to, value: "0x1", chainId: "0x1" },
  ];
  render(<DAppApprovalModal />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await jest.advanceTimersByTimeAsync(1);
  });
  expect(mockDappStore.sendApprovalResultById).toHaveBeenCalledWith(
    "session",
    "approval",
    dappHash,
  );
  expect(sign).toHaveBeenCalledTimes(2);
  expect(sharedSend).toHaveBeenCalledTimes(1);
  expect(shared.getContextObject().config).toEqual(sharedConfig);
  const dappStart = receiptPolls.find(({ hash }) => hash === dappHash)?.time;
  if (dappStart === undefined)
    throw new Error("dApp receipt polling did not start");
  await act(async () => {
    await jest.advanceTimersByTimeAsync(
      QRL_TX_POLLING_CONFIG.transactionPollingInterval,
    );
  });
  const dappPolls = receiptPolls.filter(({ hash }) => hash === dappHash);
  expect(dappPolls).toHaveLength(2);
  expect(dappPolls[1]?.time).toBe(
    dappStart + QRL_TX_POLLING_CONFIG.transactionPollingInterval,
  );

  await act(async () => {
    await jest.advanceTimersByTimeAsync(
      seedStart +
        SEND_TX_POLLING_CONFIG.transactionPollingTimeout -
        Date.now() -
        1,
    );
  });
  expect(mockQrlStore.transactionStatus.state).toBe("pending");
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1);
  });
  expect(mockQrlStore.transactionStatus.state).toBe("timeout");
  await act(async () => {
    await jest.advanceTimersByTimeAsync(
      dappStart +
        QRL_TX_POLLING_CONFIG.transactionPollingTimeout -
        Date.now() -
        1,
    );
  });
  expect(mockDappStore.setTxProgressForApproval).toHaveBeenLastCalledWith(
    "session",
    "approval",
    "confirming",
    dappHash,
    undefined,
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1);
  });
  expect(mockDappStore.setTxProgressForApproval).toHaveBeenLastCalledWith(
    "session",
    "approval",
    "unknown",
    dappHash,
    expect.any(String),
  );
  expect(mockDappStore.sendApprovalResultById).toHaveBeenCalledTimes(1);
  expect(mockDappStore.sendRejectionResultById).not.toHaveBeenCalled();
  expect(shared.getContextObject().config).toEqual(sharedConfig);
});
