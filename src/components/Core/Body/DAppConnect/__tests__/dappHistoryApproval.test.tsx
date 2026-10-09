/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import DAppApprovalModal from "../DAppApprovalModal";
import { transactionHistoryStore } from "@/stores/transactionHistoryStore";

const from = `Q${"a".repeat(128)}`;
const to = `Q${"b".repeat(128)}`;
const hash = `0x${"c".repeat(64)}`;
const mockSend = jest.fn(async () => ({ transactionHash: hash }));
const mockSign = jest.fn(async () => "0x1234");
const mockRpc = jest.fn(async (_args: unknown) => "0x1");
const mockApproval = {
  id: "approval",
  sessionId: "session",
  method: "qrl_sendTransaction",
  params: new Array<Record<string, unknown>>(),
  dappInfo: { name: "Test dApp", url: "https://dapp.example" },
};
const mockDappStore = {
  currentApproval: mockApproval,
  approvalModalOpen: true,
  txProgress: "idle",
  isCurrentApproval: () => true,
  setTxProgressForApproval: jest.fn(),
  sendApprovalResultById: jest.fn(),
  sendRejectionResultById: jest.fn(),
  approveRequestById: jest.fn(),
  rejectRequestById: jest.fn(),
};
const mockQrlStore = {
  activeAccount: { accountAddress: from },
  qrlConnection: { blockchain: "TEST_NET" },
  qrlInstance: {
    requestManager: { send: mockRpc },
    getTransactionReceipt: async () => ({
      transactionHash: hash,
      blockNumber: "0x1",
      status: "0x1",
    }),
  },
};

jest.mock("@/stores/store", () => ({
  useStore: () => ({ dappConnectStore: mockDappStore, qrlStore: mockQrlStore }),
}));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/stores/qrlStore", () => ({
  quoteFees: async () => ({
    maxFeePerGas: 1000000000n,
    maxPriorityFeePerGas: 1000000000n,
  }),
}));
jest.mock("@/desktop/bridge", () => ({
  isDesktop: true,
  buildDappOrigin: () => undefined,
  desktopSigner: {
    signAndSendTransaction: () => mockSend(),
    signTransactionOnly: () => mockSign(),
  },
}));
jest.mock("@/config", () => ({
  getExplorerTxUrl: () => "https://explorer.example/tx",
}));
jest.mock("@/config/runtimeProfile", () => ({ IS_V3_PROFILE: false }));
jest.mock("@/utils/crypto", () => ({}));
jest.mock("@/utils/signing", () => ({}));
jest.mock("@/utils/storage/storage", () => ({}));
jest.mock("@/utils/nativeWalletMutation", () => ({}));
jest.mock("@/utils/nativeApp", () => ({ isIOSNativeApp: () => false }));
jest.mock("@/hooks/useHasNativeInjectedPin", () => ({
  useHasNativeInjectedPin: () => false,
}));
jest.mock("@/utils/formatting", () => ({ formatQuantaValue: () => "0" }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
jest.mock("@theqrl/web3", () => ({ utils: {} }));
jest.mock("../DAppTransactionReview", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../DAppMessageReview", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../DAppTypedDataReview", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/UI/QrlAddress", () => ({ QrlAddress: () => null }));
jest.mock("@/components/UI/Dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogContent: ({ children }: { children: ReactNode }) => children,
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  localStorage.clear();
  transactionHistoryStore.clear();
  mockApproval.method = "qrl_sendTransaction";
  mockApproval.params = [{ from, to, value: "0x1", chainId: "0x1" }];
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function approve() {
  render(<DAppApprovalModal />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await jest.advanceTimersByTimeAsync(7000);
  });
}

it("reports the transaction chain failure before optional history parsing", async () => {
  mockApproval.params = [{ from, to, value: {}, chainId: "0x2" }];
  await approve();
  await waitFor(() =>
    expect(mockDappStore.rejectRequestById).toHaveBeenCalled(),
  );
  expect(mockRpc).toHaveBeenCalledWith({ method: "qrl_chainId", params: [] });
  expect(console.log).toHaveBeenCalledWith(
    "[DAppConnect] approval error:",
    "Transaction chain does not match the wallet network",
  );
  expect(mockSend).not.toHaveBeenCalled();
  expect(transactionHistoryStore.getSnapshot().entries).toEqual([]);
});

it("allows the existing send flow to handle a value history cannot represent", async () => {
  mockApproval.params = [{ from, to, value: "", chainId: "0x1" }];
  await approve();
  await waitFor(() =>
    expect(mockDappStore.setTxProgressForApproval).toHaveBeenCalledWith(
      "session",
      "approval",
      "confirmed",
      hash,
      undefined,
    ),
  );
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockDappStore.sendApprovalResultById).toHaveBeenCalledWith(
    "session",
    "approval",
    hash,
  );
  expect(mockDappStore.sendRejectionResultById).not.toHaveBeenCalled();
  expect(transactionHistoryStore.getSnapshot().entries).toEqual([]);
});

it("continues broadcasting and records in memory when history storage is full", async () => {
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  await approve();
  await waitFor(() =>
    expect(mockDappStore.setTxProgressForApproval).toHaveBeenCalledWith(
      "session",
      "approval",
      "confirmed",
      hash,
      undefined,
    ),
  );
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockDappStore.sendApprovalResultById).toHaveBeenCalledWith(
    "session",
    "approval",
    hash,
  );
  expect(transactionHistoryStore.getSnapshot()).toMatchObject({
    storageUnavailable: true,
    entries: [
      { from, to, hash, amount: "0.000000000000000001", state: "confirmed" },
    ],
  });
});

it("keeps signing without broadcast independent of history capture", async () => {
  mockApproval.method = "qrl_signTransaction";
  mockApproval.params = [{ from, to, value: "", chainId: "0x1" }];
  await approve();
  await waitFor(() =>
    expect(mockDappStore.approveRequestById).toHaveBeenCalledWith(
      "session",
      "approval",
      "0x1234",
    ),
  );
  expect(mockSign).toHaveBeenCalledTimes(1);
  expect(mockSend).not.toHaveBeenCalled();
  expect(transactionHistoryStore.getSnapshot().entries).toEqual([]);
});
