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
import Settings from "../Settings";
import { ExportWalletFile } from "../ExportWalletFile";
import { NetworkSettings } from "../NetworkSettings/NetworkSettings";
import { StorageUtil } from "@/utils/storage";
import {
  decryptStoredSeedAsync,
  getAddressFromMnemonicAsync,
  WalletEncryptionUtil,
} from "@/utils/crypto";
import { rotateStoredSeedPin } from "@/utils/crypto/pinRotation";
import { deferred } from "@/test-utils/deferred";
import { logger } from "@/utils/log";

const address = `Q${"1".repeat(128)}`;
const mockNavigate = jest.fn(
  (_path: string): void | Promise<void> => undefined,
);
const mockSelectBlockchain = jest.fn((_network: string) => Promise.resolve());
const mockStore = {
  qrlStore: {
    activeAccount: { accountAddress: address },
    qrlConnection: { blockchain: "TEST_NET", isLoading: false },
    qrlInstance: {},
    selectBlockchain: mockSelectBlockchain,
  },
};
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("@/components/Core/Layout/PageShell", () => ({
  PageShell: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("../../DAppConnect/DAppSessionsList", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("react-router", () => ({ useNavigate: () => mockNavigate }));
jest.mock("@/router/router", () => ({
  ROUTES: { ADDRESS_BOOK: "/address-book" },
}));
jest.mock("@/config", () => ({
  IS_V3_PROFILE: false,
  QRL_PROVIDER: { TEST_NET: {}, MAIN_NET: {} },
  AVAILABLE_NETWORKS: [
    { id: "TEST_NET", name: "Testnet" },
    { id: "MAIN_NET", name: "Mainnet" },
  ],
}));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getWalletSettings: jest.fn(),
    setWalletSettings: jest.fn(),
    hasEncryptedSeeds: jest.fn(),
    getBlockChain: jest.fn(),
    getAllEncryptedSeeds: jest.fn(),
  },
}));
jest.mock("@/utils/crypto/pinRotation", () => ({
  rotateStoredSeedPin: jest.fn(),
}));
jest.mock("@/utils/crypto", () => ({
  CryptoOperationError: class extends Error {},
  CryptoErrorCode: {},
  decryptStoredSeedAsync: jest.fn(),
  getAddressFromMnemonicAsync: jest.fn(),
  WalletEncryptionUtil: {
    validatePassword: () => true,
    downloadWallet: jest.fn(),
  },
}));
jest.mock("@/components/UI/QrlAddress", () => ({
  QrlAddress: ({ address }: { address: string }) => address,
}));

const settings = {
  autoLockTimeout: 900000,
  showTokensCard: false,
  showNftsCard: true,
};
const storedSeeds = [
  {
    address: "preserved-other-account",
    encryptedSeed: "other ciphertext",
    lastAccessed: 1,
  },
  { address, encryptedSeed: "active ciphertext", lastAccessed: 2 },
];
beforeEach(() => {
  jest.resetAllMocks();
  localStorage.clear();
  mockStore.qrlStore.activeAccount.accountAddress = address;
  mockSelectBlockchain.mockResolvedValue(undefined);
  jest.mocked(StorageUtil).getWalletSettings.mockResolvedValue(settings);
  jest.mocked(StorageUtil).setWalletSettings.mockResolvedValue(undefined);
  jest.mocked(StorageUtil).hasEncryptedSeeds.mockResolvedValue(true);
  jest.mocked(StorageUtil).getBlockChain.mockResolvedValue("TEST_NET");
  jest.mocked(StorageUtil).getAllEncryptedSeeds.mockResolvedValue(storedSeeds);
  jest.mocked(decryptStoredSeedAsync).mockResolvedValue({
    mnemonic: "synthetic mnemonic",
    hexSeed: "synthetic seed",
  });
  jest.mocked(getAddressFromMnemonicAsync).mockResolvedValue(address);
  jest.mocked(WalletEncryptionUtil).downloadWallet.mockResolvedValue(undefined);
  jest.mocked(rotateStoredSeedPin).mockResolvedValue({ rotatedSeeds: 2 });
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function fillPins(values: string[]) {
  values.forEach((value, row) => {
    for (let index = 0; index < value.length; index++) {
      const digit = value.charAt(index);
      const input = screen.getAllByLabelText(`PIN digit ${index + 1}`)[row];
      if (!input) throw new Error("PIN input is missing");
      fireEvent.change(input, { target: { value: digit } });
    }
  });
}

function submitExport() {
  fireEvent.click(screen.getByRole("button", { name: /Export Wallet File/ }));
  fillPins(["123456"]);
  fireEvent.change(screen.getByLabelText("File Password"), {
    target: { value: "Synthetic!123" },
  });
  fireEvent.change(screen.getByLabelText("Confirm File Password"), {
    target: { value: "Synthetic!123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Export Wallet File" }));
}

it("preserves pending preference defaults, debounce timing and overlapping saves", async () => {
  jest.useFakeTimers();
  const defaults = deferred<typeof settings>();
  const firstWrite = deferred<undefined>();
  jest
    .mocked(StorageUtil)
    .getWalletSettings.mockReturnValueOnce(defaults.promise);
  jest
    .mocked(StorageUtil)
    .setWalletSettings.mockReturnValueOnce(firstWrite.promise);
  render(<Settings />);
  expect(
    screen
      .getByRole("switch", { name: /Show Tokens Card/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(
    screen
      .getByRole("switch", { name: /Show NFTs Card/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
  await act(async () => {
    defaults.resolve(settings);
    await defaults.promise;
  });
  expect(
    screen
      .getByRole("switch", { name: /Show Tokens Card/ })
      .getAttribute("aria-checked"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("switch", { name: /Show Tokens Card/ }));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(199);
  });
  expect(jest.mocked(StorageUtil).setWalletSettings).not.toHaveBeenCalled();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1);
  });
  expect(jest.mocked(StorageUtil).setWalletSettings).toHaveBeenNthCalledWith(
    1,
    { ...settings, showTokensCard: true },
  );
  fireEvent.click(screen.getByRole("switch", { name: /Show NFTs Card/ }));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(200);
  });
  expect(jest.mocked(StorageUtil).setWalletSettings).toHaveBeenNthCalledWith(
    2,
    { ...settings, showTokensCard: true, showNftsCard: false },
  );
  await act(async () => {
    firstWrite.resolve(undefined);
    await firstWrite.promise;
  });
});

it("flushes a pending preference save on unmount and preserves unrelated storage", async () => {
  localStorage.setItem("TEST_NET_ENCRYPTED_SEEDS", "preserved ciphertext");
  const view = render(<Settings />);
  await waitFor(() => {
    expect(screen.getByRole("spinbutton")).toHaveProperty("value", "15");
  });
  fireEvent.click(screen.getByRole("switch", { name: /Show Tokens Card/ }));
  view.unmount();
  await waitFor(() => {
    expect(jest.mocked(StorageUtil).setWalletSettings).toHaveBeenCalledWith({
      ...settings,
      showTokensCard: true,
    });
  });
  expect(localStorage.getItem("TEST_NET_ENCRYPTED_SEEDS")).toBe(
    "preserved ciphertext",
  );
});

it.each(["pagehide", "visibilitychange"] as const)(
  "flushes a pending preference save exactly once on %s",
  async (event) => {
    jest.useFakeTimers();
    jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const view = render(<Settings />);
    await waitFor(() => {
      expect(screen.getByRole("spinbutton")).toHaveProperty("value", "15");
    });
    fireEvent.click(screen.getByRole("switch", { name: /Show Tokens Card/ }));
    expect(StorageUtil.setWalletSettings).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent(event === "pagehide" ? window : document, new Event(event));
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(StorageUtil.setWalletSettings).toHaveBeenCalledTimes(1);
    expect(StorageUtil.setWalletSettings).toHaveBeenCalledWith({
      ...settings,
      showTokensCard: true,
    });

    await act(async () => {
      fireEvent(window, new Event("pagehide"));
      fireEvent(document, new Event("visibilitychange"));
      await jest.advanceTimersByTimeAsync(800);
      view.unmount();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(StorageUtil.setWalletSettings).toHaveBeenCalledTimes(1);
  },
);

it.each(["pagehide", "visibilitychange"] as const)(
  "does not write preferences on %s without a pending change",
  async (event) => {
    jest.useFakeTimers();
    jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByRole("spinbutton")).toHaveProperty("value", "15");
    });

    await act(async () => {
      fireEvent(event === "pagehide" ? window : document, new Event(event));
      await jest.advanceTimersByTimeAsync(800);
    });
    expect(StorageUtil.setWalletSettings).not.toHaveBeenCalled();
  },
);

it("keeps a pending preference save debounced when the page becomes visible", async () => {
  jest.useFakeTimers();
  jest.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  render(<Settings />);
  await waitFor(() => {
    expect(screen.getByRole("spinbutton")).toHaveProperty("value", "15");
  });
  fireEvent.click(screen.getByRole("switch", { name: /Show Tokens Card/ }));

  await act(async () => {
    fireEvent(document, new Event("visibilitychange"));
    await jest.advanceTimersByTimeAsync(199);
  });
  expect(StorageUtil.setWalletSettings).not.toHaveBeenCalled();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1);
  });
  expect(StorageUtil.setWalletSettings).toHaveBeenCalledTimes(1);
  expect(StorageUtil.setWalletSettings).toHaveBeenCalledWith({
    ...settings,
    showTokensCard: true,
  });
});

it("loads a string timeout and keeps invalid display preferences subject to form validation", async () => {
  jest.useFakeTimers();
  jest.mocked(StorageUtil).getWalletSettings.mockResolvedValue({
    autoLockTimeout: "60000",
    showTokensCard: "false",
    showNftsCard: true,
  });
  render(<Settings />);
  await waitFor(() => {
    expect(screen.getByRole("spinbutton")).toHaveProperty("value", "1");
  });
  expect(
    screen
      .getByRole("switch", { name: /Show Tokens Card/ })
      .getAttribute("data-state"),
  ).toBe("checked");
  expect(
    screen
      .getByRole("switch", { name: /Show Tokens Card/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("switch", { name: /Show NFTs Card/ }));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(200);
  });
  expect(StorageUtil.setWalletSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("switch", { name: /Show Tokens Card/ }));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(200);
  });
  expect(StorageUtil.setWalletSettings).toHaveBeenCalledWith({
    autoLockTimeout: 60000,
    showTokensCard: false,
    showNftsCard: false,
  });
});

it("reports an encrypted-seed check failure without changing preferences", async () => {
  const failure = new Error("Storage unavailable");
  const report = jest
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  jest.mocked(StorageUtil).hasEncryptedSeeds.mockRejectedValueOnce(failure);
  render(<Settings />);
  await waitFor(() => {
    expect(report).toHaveBeenCalledWith(
      "Failed to check encrypted seeds:",
      failure,
    );
  });
  expect(jest.mocked(StorageUtil).setWalletSettings).not.toHaveBeenCalled();
});

it.each(["submit", "validate"] as const)(
  "reports rejected preference %s promises without writing settings",
  async (operation) => {
    jest.useFakeTimers();
    const failure = new Error("Validation unavailable");
    const report = jest
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    jest
      .spyOn(
        jest.requireActual<typeof import("@hookform/resolvers/zod")>(
          "@hookform/resolvers/zod",
        ),
        "zodResolver",
      )
      .mockImplementation(() => () => Promise.reject(failure));
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByRole("spinbutton")).toHaveProperty("value", "15");
    });
    if (operation === "submit") {
      fireEvent.click(screen.getByRole("switch", { name: /Show Tokens Card/ }));
    } else {
      fireEvent.change(screen.getByRole("spinbutton"), {
        target: { value: "" },
      });
    }
    await act(async () => {
      await jest.advanceTimersByTimeAsync(800);
    });
    expect(report).toHaveBeenCalledWith(
      `Failed to ${operation} wallet settings:`,
      failure,
    );
    expect(
      screen.getByText("There was an error saving your settings."),
    ).toBeTruthy();
    expect(jest.mocked(StorageUtil).setWalletSettings).not.toHaveBeenCalled();
  },
);

it("starts address-book navigation on click and reports rejection", async () => {
  const failure = new Error("Navigation unavailable");
  const report = jest
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  mockNavigate.mockRejectedValueOnce(failure);
  render(<Settings />);
  fireEvent.click(screen.getByRole("button", { name: /Address Book/ }));
  expect(mockNavigate).toHaveBeenCalledWith("/address-book");
  await waitFor(() => {
    expect(report).toHaveBeenCalledWith(
      "Failed to open address book:",
      failure,
    );
  });
});

it("starts every network selection immediately with the store receiver", async () => {
  const first = deferred<undefined>();
  const failure = new Error("Network unavailable");
  const report = jest
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  mockSelectBlockchain
    .mockReturnValueOnce(first.promise)
    .mockRejectedValueOnce(failure);
  render(<NetworkSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Mainnet" }));
  fireEvent.click(screen.getByRole("button", { name: "Testnet" }));
  expect(mockSelectBlockchain.mock.calls).toEqual([["MAIN_NET"], ["TEST_NET"]]);
  expect(mockSelectBlockchain.mock.contexts).toEqual([
    mockStore.qrlStore,
    mockStore.qrlStore,
  ]);
  await waitFor(() => {
    expect(report).toHaveBeenCalledWith("Failed to select network:", failure);
  });
  first.resolve(undefined);
});

it("exports the submitted account after decryption and download, preserving stored order", async () => {
  const unlock = deferred<Awaited<ReturnType<typeof decryptStoredSeedAsync>>>();
  const download = deferred<undefined>();
  jest.mocked(decryptStoredSeedAsync).mockReturnValueOnce(unlock.promise);
  jest
    .mocked(WalletEncryptionUtil)
    .downloadWallet.mockReturnValueOnce(download.promise);
  const before = JSON.stringify(storedSeeds);
  localStorage.setItem("TEST_NET_ENCRYPTED_SEEDS", before);
  const view = render(<ExportWalletFile />);
  submitExport();
  await waitFor(() => {
    expect(decryptStoredSeedAsync).toHaveBeenCalledWith(
      "TEST_NET",
      address,
      "active ciphertext",
      "123456",
    );
  });
  expect(getAddressFromMnemonicAsync).not.toHaveBeenCalled();
  mockStore.qrlStore.activeAccount.accountAddress = "changed-active-account";
  view.rerender(<ExportWalletFile />);
  await act(async () => {
    unlock.resolve({
      mnemonic: "synthetic mnemonic",
      hexSeed: "synthetic seed",
    });
    await unlock.promise;
  });
  expect(jest.mocked(WalletEncryptionUtil).downloadWallet.mock.calls).toEqual([
    [
      { address, mnemonic: "synthetic mnemonic", hexSeed: "synthetic seed" },
      "Synthetic!123",
    ],
  ]);
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => {
    download.resolve(undefined);
    await download.promise;
  });
  expect(screen.getByRole("status").textContent).toContain(
    "Encrypted wallet file downloaded",
  );
  expect(JSON.stringify(storedSeeds)).toBe(before);
  expect(localStorage.getItem("TEST_NET_ENCRYPTED_SEEDS")).toBe(before);
});

it("retains the export error and reports a rejected download", async () => {
  const failure = new Error("Download unavailable");
  const report = jest
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  jest
    .mocked(WalletEncryptionUtil)
    .downloadWallet.mockRejectedValueOnce(failure);
  render(<ExportWalletFile />);
  submitExport();
  await screen.findByText(
    "An unexpected error occurred while exporting the wallet file.",
  );
  expect(report).toHaveBeenCalledWith("Error exporting wallet file:", failure);
  expect(screen.queryByRole("status")).toBeNull();
});

it("keeps PIN-change completion behind rotation and preserves its error", async () => {
  const rotation = deferred<Awaited<ReturnType<typeof rotateStoredSeedPin>>>();
  const failure = new Error("Rotation unavailable");
  const report = jest
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  jest.mocked(rotateStoredSeedPin).mockReturnValueOnce(rotation.promise);
  render(<Settings />);
  fireEvent.click(await screen.findByRole("button", { name: /Change PIN/ }));
  fillPins(["123456", "654321", "654321"]);
  fireEvent.click(screen.getByRole("button", { name: "Change PIN" }));
  await waitFor(() => {
    expect(rotateStoredSeedPin).toHaveBeenCalledWith({
      blockchains: ["TEST_NET", "MAIN_NET"],
      oldPin: "123456",
      newPin: "654321",
    });
  });
  expect(screen.getByRole("button", { name: "Changing PIN..." })).toBeTruthy();
  await act(async () => {
    rotation.reject(failure);
    await rotation.promise.catch(() => undefined);
  });
  expect(report).toHaveBeenCalledWith("Error changing PIN:", failure);
  expect(
    screen.getByText(
      "An unexpected error occurred while changing your PIN. Please try again.",
    ),
  ).toBeTruthy();
});

it.each([
  ["0", "Too small: expected number to be >=1"],
  ["61", "Too big: expected number to be <=60"],
  ["", "Invalid input: expected number, received NaN"],
])(
  "preserves origin/dev auto-lock validation for %s",
  async (value, expected) => {
    jest.useFakeTimers();
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByRole("spinbutton")).toHaveProperty("value", "15");
    });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value } });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText(expected).textContent).toBe(expected);
    expect(StorageUtil.setWalletSettings).not.toHaveBeenCalled();
  },
);

it.each([
  [
    "PIN rotation failed and rollback could not be fully confirmed. Keep the old PIN and re-import any inaccessible account.",
    "An unexpected error occurred while changing your PIN. Please try again.",
  ],
  [
    "Device backup failed; the old PIN remains active. Details: fixture",
    "Device backup failed; the old PIN remains active. Details: fixture",
  ],
])(
  "preserves origin/dev PIN rotation error presentation (%s)",
  async (reason, expected) => {
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    jest.mocked(rotateStoredSeedPin).mockRejectedValueOnce(new Error(reason));
    render(<Settings />);
    fireEvent.click(await screen.findByRole("button", { name: /Change PIN/ }));
    fillPins(["123456", "654321", "654321"]);
    fireEvent.click(screen.getByRole("button", { name: "Change PIN" }));
    expect((await screen.findByText(expected)).textContent).toBe(expected);
  },
);
