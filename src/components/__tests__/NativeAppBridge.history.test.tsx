/** @jest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import NativeAppBridge from "../NativeAppBridge";
import { transactionHistoryStore } from "@/stores/transactionHistoryStore";
import {
  confirmWalletCleared,
  subscribeToNativeMessages,
} from "@/utils/nativeApp";
import type { NativeMessage } from "@/utils/nativeApp";
import { clearAddressBook } from "@/utils/addressBook";

jest.mock("react-router", () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ search: "" }),
}));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => true,
  subscribeToNativeMessages: jest.fn(),
  confirmWalletCleared: jest.fn(),
  clearNativeInjectedPin: jest.fn(),
  notifyWebAppReady: jest.fn(),
  logToNative: jest.fn(),
}));
jest.mock("@/utils/storage/storage", () => ({
  __esModule: true,
  default: {
    clearActiveAccount: jest.fn(async () => undefined),
    clearTransactionValues: jest.fn(async () => undefined),
    clearAllEncryptedSeeds: jest.fn(),
    clearAccountList: jest.fn(),
    clearAllTokenData: jest.fn(),
    clearAllNftData: jest.fn(),
    getActiveAccount: async () => "",
    getAllEncryptedSeeds: async () => [],
    getAccountList: async () => [],
  },
}));
jest.mock("@/utils/crypto", () => ({}));
jest.mock("@/utils/crypto/walletEncryption", () => ({}));
jest.mock("@/utils/crypto/pinRotation", () => ({}));
jest.mock("@/utils/crypto/deviceCredential", () => ({
  clearDeviceCredential: async () => undefined,
}));
jest.mock("@/utils/addressBook", () => ({ clearAddressBook: jest.fn() }));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: {
    clear: async (clear: () => Promise<void>, after: () => Promise<void>) => {
      await clear();
      await after();
      await clear();
    },
  },
}));
jest.mock("@/services/dappConnect/DAppConnectService", () => ({
  dappConnectService: {
    clearAllSessions: async () => undefined,
    getActiveSessions: () => [],
  },
}));
jest.mock("@/utils/mobileConnect/mobileConnection", () => ({
  disconnectMobile: async () => undefined,
  hasMobileSession: () => false,
}));
jest.mock("@/router/router", () => ({ ROUTES: { HOME: "/" } }));
jest.mock("@/config", () => ({ QRL_PROVIDER: { TEST_NET_V3: {} } }));
jest.mock("@/stores/store", () => ({
  store: {
    qrlStore: {
      activeAccount: { accountAddress: "" },
      setActiveAccount: async () => undefined,
    },
  },
}));

let receive: (message: NativeMessage) => void = () => undefined;
const requestId = "a".repeat(32);
const details = {
  blockchain: "TEST_NET_V3",
  from: `Q${"a".repeat(128)}`,
  to: `Q${"b".repeat(128)}`,
  hash: `0x${"c".repeat(64)}`,
  amount: "1",
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  transactionHistoryStore.reload();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.mocked(subscribeToNativeMessages).mockImplementation((listener) => {
    receive = listener;
    return () => undefined;
  });
  render(<NativeAppBridge />);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it("erases history for every chain and account before confirming CLEAR_WALLET", async () => {
  transactionHistoryStore.record(details);
  transactionHistoryStore.record({
    ...details,
    blockchain: "MAIN_NET",
    from: details.to,
  });
  localStorage.setItem("qrl:transaction-history:v1:broken", "{");
  localStorage.setItem("preferences", "keep");
  receive({ type: "CLEAR_WALLET", payload: { requestId } });
  await waitFor(() =>
    expect(confirmWalletCleared).toHaveBeenCalledWith(requestId, true),
  );
  expect(clearAddressBook).toHaveBeenCalled();
  expect(transactionHistoryStore.getSnapshot().entries).toEqual([]);
  transactionHistoryStore.reload();
  expect(transactionHistoryStore.getSnapshot().entries).toEqual([]);
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem("preferences")).toBe("keep");
});

it("reports failure when history cannot be removed from storage", async () => {
  transactionHistoryStore.record(details);
  jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("storage denied");
  });
  receive({ type: "CLEAR_WALLET", payload: { requestId } });
  await waitFor(() =>
    expect(confirmWalletCleared).toHaveBeenCalledWith(
      requestId,
      false,
      "Web wallet clear failed",
    ),
  );
});

it("keeps history when CLEAR_WALLET has an invalid request ID", () => {
  const entry = transactionHistoryStore.record(details);
  receive({ type: "CLEAR_WALLET", payload: { requestId: "invalid" } });
  expect(transactionHistoryStore.getSnapshot().entries).toEqual([entry]);
  expect(confirmWalletCleared).not.toHaveBeenCalled();
});
