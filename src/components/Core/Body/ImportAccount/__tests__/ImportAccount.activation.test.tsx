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
import ImportAccount from "../ImportAccount";
import {
  encryptSeedAsync,
  decryptStoredSeedAsync,
  CryptoOperationError,
  CryptoErrorCode,
} from "@/utils/crypto";
import { notifySeedStored, openNativeSettings } from "@/utils/nativeApp";
import { StorageUtil } from "@/utils/storage";
import { desktopSigner } from "@/desktop/bridge";
import { walletMutations } from "@/utils/nativeWalletMutation";

const mockSelectAccount = jest.fn(
  async (_address: string): Promise<void> => undefined,
);
let mockDesktop = false;
let mockNative = true;
const mockAccount = {
  address: `Q${"12".repeat(64)}`,
  mnemonic: "synthetic mnemonic",
  hexSeed: "synthetic extended seed",
};

jest.mock("@/stores/store", () => ({
  useStore: () => ({
    qrlStore: {
      setActiveAccount: mockSelectAccount,
      qrlConnection: { blockchain: "TEST_NET_V3" },
    },
  }),
}));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/utils", () => jest.requireActual("@/utils/cn"));
jest.mock("@/hooks/useWalletLimit", () => ({
  useWalletLimit: () => ({ isWalletLimitReached: false }),
}));
jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));
jest.mock("@/router/router", () => ({ ROUTES: {} }));
jest.mock("react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("@/components/UI/Tabs", () => {
  const Container = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Tabs: Container,
    TabsContent: Container,
    TabsList: Container,
    TabsTrigger: Container,
  };
});
jest.mock("../ImportAccountForm/ImportAccountForm", () => ({
  ImportAccountForm: ({
    onAccountImported,
  }: {
    onAccountImported: (account: unknown) => void;
  }) => (
    <button onClick={() => onAccountImported(mockAccount)}>
      Supply mnemonic
    </button>
  ),
}));
jest.mock("../ImportHexSeedForm/ImportHexSeedForm", () => ({
  ImportHexSeedForm: ({
    onAccountImported,
  }: {
    onAccountImported: (account: unknown) => void;
  }) => (
    <button onClick={() => onAccountImported(mockAccount)}>
      Supply hex seed
    </button>
  ),
}));
jest.mock("../ImportEncryptedWallet/ImportEncryptedWallet", () => ({
  ImportEncryptedWallet: ({
    onWalletImported,
  }: {
    onWalletImported: (account: unknown) => void;
  }) => (
    <button onClick={() => onWalletImported(mockAccount)}>
      Supply exported backup
    </button>
  ),
}));
jest.mock("../AccountImportSuccess/AccountImportSuccess", () => ({
  __esModule: true,
  default: () => <h1>Import complete</h1>,
}));
jest.mock("@/utils/crypto", () => {
  class CryptoOperationError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    encryptSeedAsync: jest.fn(),
    decryptStoredSeedAsync: jest.fn(),
    CryptoOperationError,
    CryptoErrorCode: {
      DEVICE_CREDENTIAL_UNAVAILABLE: "DEVICE_CREDENTIAL_UNAVAILABLE",
      INCORRECT_PIN: "INCORRECT_PIN",
    },
  };
});
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getAllEncryptedSeeds: jest.fn(),
    storeEncryptedSeed: jest.fn(),
  },
}));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => mockNative && !mockDesktop,
  notifySeedStored: jest.fn(),
  openNativeSettings: jest.fn(() => true),
}));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: { importWallet: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectAccount.mockResolvedValue(undefined);
  mockDesktop = false;
  mockNative = true;
  window.scrollTo = jest.fn();
  jest.mocked(encryptSeedAsync).mockResolvedValue("encrypted seed");
  jest.mocked(StorageUtil.getAllEncryptedSeeds).mockResolvedValue([]);
  jest.mocked(StorageUtil.storeEncryptedSeed).mockResolvedValue({
    ...mockAccount,
    encryptedSeed: "encrypted seed",
    lastAccessed: 1,
    revision: 1,
  });
  jest
    .mocked(notifySeedStored)
    .mockResolvedValue({ revision: 1, ciphertextHash: "ab".repeat(32) });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function enterPin() {
  await screen.findByText("Set Transaction PIN");
  for (let row = 0; row < 2; row++) {
    for (let index = 1; index <= 6; index++) {
      const input = screen.getAllByLabelText(`PIN digit ${index}`)[row];
      if (!input) throw new Error("PIN input is missing");
      fireEvent.change(input, {
        target: { value: String(index) },
      });
    }
  }
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Set PIN" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Set PIN" }));
}

it.each(["mnemonic", "hex seed", "exported backup"])(
  "selects a %s import only after native acknowledgement",
  async (kind) => {
    let acknowledge!: (value: {
      revision: number;
      ciphertextHash: string;
    }) => void;
    jest.mocked(notifySeedStored).mockImplementation(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    render(<ImportAccount />);
    fireEvent.click(screen.getByRole("button", { name: `Supply ${kind}` }));
    expect(mockSelectAccount).not.toHaveBeenCalled();
    await enterPin();
    await waitFor(() => expect(notifySeedStored).toHaveBeenCalledTimes(1));
    expect(mockSelectAccount).not.toHaveBeenCalled();
    expect(screen.queryByText("Import complete")).toBeNull();
    await act(async () => {
      acknowledge({ revision: 1, ciphertextHash: "ab".repeat(32) });
    });
    await screen.findByText("Import complete");
    expect(mockSelectAccount).toHaveBeenCalledTimes(1);
    expect(mockSelectAccount).toHaveBeenCalledWith(mockAccount.address);
  },
);

it("keeps the existing active wallet when native backup fails", async () => {
  jest
    .mocked(notifySeedStored)
    .mockRejectedValue(new Error("Native backup unavailable"));
  render(<ImportAccount />);
  fireEvent.click(screen.getByRole("button", { name: "Supply mnemonic" }));
  await enterPin();
  await screen.findByText(/Native backup unavailable/);
  expect(mockSelectAccount).not.toHaveBeenCalled();
  expect(screen.queryByText("Import complete")).toBeNull();
});

it("rejects activation when clear arrives during native backup acknowledgement", async () => {
  let acknowledge!: (value: {
    revision: number;
    ciphertextHash: string;
  }) => void;
  jest.mocked(notifySeedStored).mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  render(<ImportAccount />);
  fireEvent.click(screen.getByRole("button", { name: "Supply mnemonic" }));
  await enterPin();
  await waitFor(() => expect(notifySeedStored).toHaveBeenCalledTimes(1));
  await act(async () => {
    const clearing = walletMutations.clear(() => localStorage.clear());
    acknowledge({ revision: 1, ciphertextHash: "ab".repeat(32) });
    await clearing;
  });
  expect(mockSelectAccount).not.toHaveBeenCalled();
  expect(screen.queryByText("Import complete")).toBeNull();
  await screen.findByText(/Wallet was cleared during account import/);
});

it.each(["mnemonic", "hex seed", "exported backup"])(
  "selects a browser %s import after local encryption succeeds",
  async (kind) => {
    mockNative = false;
    render(<ImportAccount />);
    fireEvent.click(screen.getByRole("button", { name: `Supply ${kind}` }));
    expect(mockSelectAccount).not.toHaveBeenCalled();
    await enterPin();
    await screen.findByText("Import complete");
    expect(StorageUtil.storeEncryptedSeed).toHaveBeenCalledTimes(1);
    expect(mockSelectAccount).toHaveBeenCalledTimes(1);
    expect(mockSelectAccount).toHaveBeenCalledWith(mockAccount.address);
    expect(notifySeedStored).not.toHaveBeenCalled();
  },
);

it("preserves the active wallet and factor while offering recovery settings", async () => {
  jest.mocked(StorageUtil.getAllEncryptedSeeds).mockResolvedValue([
    {
      address: "existing",
      encryptedSeed: "preserved ciphertext",
      lastAccessed: 1,
    },
  ]);
  jest
    .mocked(decryptStoredSeedAsync)
    .mockRejectedValue(
      new CryptoOperationError(
        CryptoErrorCode.DEVICE_CREDENTIAL_UNAVAILABLE,
        "Unavailable",
      ),
    );
  render(<ImportAccount />);
  fireEvent.click(screen.getByRole("button", { name: "Supply mnemonic" }));
  await screen.findByText("Enter Your Wallet PIN");
  for (let index = 1; index <= 6; index++)
    fireEvent.change(screen.getByLabelText(`PIN digit ${index}`), {
      target: { value: String(index) },
    });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Import Wallet" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Import Wallet" }));
  await screen.findByRole("alert", { name: "Wallet recovery guidance" });
  expect(mockSelectAccount).not.toHaveBeenCalled();
  expect(encryptSeedAsync).not.toHaveBeenCalled();
  expect(StorageUtil.storeEncryptedSeed).not.toHaveBeenCalled();
  expect(notifySeedStored).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open app settings" }));
  expect(openNativeSettings).toHaveBeenCalledTimes(1);
  expect(mockSelectAccount).not.toHaveBeenCalled();
});

it("keeps desktop activation behind successful signer import", async () => {
  mockDesktop = true;
  jest.mocked(desktopSigner.importWallet).mockResolvedValue({
    hasWallet: true,
    locked: false,
    address: mockAccount.address,
  });
  render(<ImportAccount />);
  fireEvent.click(screen.getByRole("button", { name: "Supply mnemonic" }));
  expect(mockSelectAccount).not.toHaveBeenCalled();
  fireEvent.change(screen.getByPlaceholderText("Password"), {
    target: { value: "Synthetic!123" },
  });
  fireEvent.change(screen.getByPlaceholderText("Re-enter the password"), {
    target: { value: "Synthetic!123" },
  });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: /Import wallet/i })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: /Import wallet/i }));
  await screen.findByText("Import complete");
  expect(mockSelectAccount).toHaveBeenCalledTimes(1);
  expect(mockSelectAccount).toHaveBeenCalledWith(mockAccount.address);
  expect(encryptSeedAsync).not.toHaveBeenCalled();
  expect(notifySeedStored).not.toHaveBeenCalled();
});

it("rejects import success when clear arrives during account selection", async () => {
  let finishSelection!: () => void;
  let activeMetadata: string | null = null;
  mockSelectAccount.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSelection = () => {
          activeMetadata = mockAccount.address;
          resolve();
        };
      }),
  );
  render(<ImportAccount />);
  fireEvent.click(screen.getByRole("button", { name: "Supply mnemonic" }));
  await enterPin();
  await waitFor(() => expect(mockSelectAccount).toHaveBeenCalledTimes(1));
  await act(async () => {
    const clearing = walletMutations.clear(() => {
      activeMetadata = null;
    });
    finishSelection();
    await clearing;
  });
  expect(activeMetadata).toBeNull();
  expect(screen.queryByText("Import complete")).toBeNull();
  await screen.findByText(/Wallet was cleared during account import/);
});
