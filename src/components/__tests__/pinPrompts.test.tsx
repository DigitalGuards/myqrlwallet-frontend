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
import { AccountCreationForm } from "../Core/Body/CreateAccount/AccountCreationForm/AccountCreationForm";
import { TokenCreationForm } from "../Core/Body/CreateToken/TokenCreationForm/TokenCreationForm";
import { PinSetup } from "../Core/Body/PinSetup/PinSetup";
import Settings from "../Core/Body/Settings/Settings";
import { ExportWalletFile } from "../Core/Body/Settings/ExportWalletFile";
import {
  decryptSeedAsync,
  encryptSeedAsync,
} from "@/utils/crypto/cryptoWorkerClient";
import {
  decryptStoredSeedAsync,
  decryptStoredSeedWithPin,
  WalletEncryptionUtil,
} from "@/utils/crypto";
import {
  checkLockout,
  getRemainingAttempts,
} from "@/utils/crypto/pinAttemptTracker";
import { StorageUtil } from "@/utils/storage";

const ADDRESS = `Q${"1".repeat(128)}`;
const mockCreated = jest.fn();
const mockCreateAccount = jest.fn();
const mockStore = {
  qrlStore: {
    activeAccount: { accountAddress: ADDRESS },
    activeAccountSource: "seed",
    qrlConnection: { blockchain: "TEST_NET" },
    qrlInstance: { accounts: { create: mockCreateAccount } },
  },
  tokenStore: { setCreatingToken: jest.fn() },
};
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/utils", () => jest.requireActual("@/utils/cn"));
jest.mock("@/router/router", () => ({ ROUTES: {} }));
jest.mock("react-router", () => ({ useNavigate: () => jest.fn() }));
jest.mock("@/components/Core/Layout/PageShell", () => ({
  PageShell: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("../Core/Body/Settings/NetworkSettings/NetworkSettings", () => ({
  NetworkSettings: () => null,
}));
jest.mock("../Core/Body/DAppConnect/DAppSessionsList", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/config", () => ({ QRL_PROVIDER: { TEST_NET: {} } }));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("@/utils/web3", () => ({ isValidQrlAddress: () => true }));
jest.mock("@/utils/storage/storage", () => ({
  __esModule: true,
  default: {
    getBlockChain: async () => "TEST_NET",
    getAllEncryptedSeeds: jest.fn(),
    getEncryptedSeed: async () => "encrypted-fixture",
    hasEncryptedSeeds: async () => true,
    getWalletSettings: async () => ({ autoLockTimeout: 900000 }),
    replaceEncryptedSeedSetIfUnchanged: jest.fn(async () => true),
    storeEncryptedSeed: jest.fn(),
  },
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: jest.requireMock("@/utils/storage/storage").default,
}));
jest.mock("@/utils/crypto/cryptoWorkerClient", () => ({
  CryptoOperationError: class extends Error {},
  CryptoErrorCode: {},
  decryptSeedAsync: jest.fn(),
  encryptSeedAsync: jest.fn(),
}));
jest.mock("@/utils/crypto/seedIdentity", () => ({
  deriveCanonicalAddressFromHexSeed: () => `Q${"1".repeat(128)}`,
}));
jest.mock("@/utils/crypto", () => ({
  ...jest.requireMock("@/utils/crypto/cryptoWorkerClient"),
  decryptStoredSeedAsync: jest.fn(),
  decryptStoredSeedWithPin: jest.fn(),
  DeviceCredentialUnavailableError: class extends Error {},
  getAddressFromMnemonicAsync: async () => `Q${"1".repeat(128)}`,
  WalletEncryptionUtil: {
    validatePassword: () => true,
    downloadWallet: jest.fn(),
  },
}));
jest.mock("@/components/UI/PinInput/PinInput", () => ({
  PinInput: ({
    value,
    onChange,
    placeholder = "PIN",
    error,
    disabled,
  }: {
    value: string;
    onChange: (pin: string) => void;
    placeholder?: string;
    error?: string;
    disabled?: boolean;
  }) => (
    <div>
      <input
        aria-label={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <p>{error}</p>}
    </div>
  ),
}));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  globalThis.ResizeObserver = MockResizeObserver;
  jest.clearAllMocks();
  localStorage.clear();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest
    .mocked(StorageUtil.getAllEncryptedSeeds)
    .mockResolvedValue([
      { address: ADDRESS, encryptedSeed: "fixture", lastAccessed: 1 },
    ]);
  const error = Object.assign(new Error("Incorrect PIN"), {
    code: "INCORRECT_PIN",
  });
  jest.mocked(decryptSeedAsync).mockRejectedValue(error);
  jest.mocked(decryptStoredSeedAsync).mockRejectedValue(error);
  jest.mocked(decryptStoredSeedWithPin).mockRejectedValue(error);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function fill(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

async function prompt(kind: string): Promise<HTMLElement> {
  if (kind === "Settings") {
    render(<Settings />);
    fireEvent.click(await screen.findByRole("button", { name: /Change PIN/ }));
    fill(screen.getByLabelText("Enter new PIN"), "123456");
    fill(screen.getByLabelText("Confirm new PIN"), "123456");
    return screen.getByLabelText("Enter current PIN");
  }
  if (kind === "ExportWalletFile") {
    render(<ExportWalletFile />);
    fireEvent.click(screen.getByRole("button", { name: /Export Wallet File/ }));
    fill(screen.getByLabelText("File Password"), "Password1!");
    fill(screen.getByLabelText("Confirm File Password"), "Password1!");
    return screen.getByLabelText("Enter your PIN");
  }
  if (kind === "AccountCreationForm") {
    render(<AccountCreationForm onAccountCreated={mockCreated} />);
    fill(await screen.findByPlaceholderText("Password"), "Password1!");
    fill(screen.getByPlaceholderText("Re-enter the password"), "Password1!");
    return screen.getByLabelText("Your existing PIN");
  }
  if (kind === "PinSetup") {
    render(
      <PinSetup
        accountAddress={ADDRESS}
        mnemonic="fixture"
        hexSeed="00"
        onPinSetupComplete={mockCreated}
      />,
    );
    return screen.findByLabelText("Enter your existing PIN");
  }
  render(<TokenCreationForm onTokenCreated={mockCreated} />);
  fill(screen.getByPlaceholderText("Example: MyQRLWallet"), "Token");
  fill(screen.getByPlaceholderText("Example: MQW"), "TOK");
  return screen.getByLabelText("Enter your PIN");
}

it.each([
  "Settings",
  "ExportWalletFile",
  "AccountCreationForm",
  "PinSetup",
  "TokenCreationForm",
])(
  "%s counts each wrong PIN and refuses decryption after the fifth failure",
  async (kind) => {
    const pin = await prompt(kind);
    const form = pin.closest("form");
    if (!form) throw new Error("PIN form is missing");
    const decrypt =
      kind === "Settings"
        ? decryptSeedAsync
        : kind === "TokenCreationForm"
          ? decryptStoredSeedWithPin
          : decryptStoredSeedAsync;
    for (let attempt = 1; attempt <= 5; attempt++) {
      await act(async () => {
        fill(pin, `99999${attempt}`);
        fireEvent.submit(form);
      });
      await waitFor(() => expect(getRemainingAttempts()).toBe(5 - attempt));
      expect(decrypt).toHaveBeenCalledTimes(attempt);
      expect(
        screen.getByText(
          attempt === 5
            ? "Too many failed attempts. Please wait 15 minutes."
            : `Incorrect PIN. ${5 - attempt} attempt${attempt === 4 ? "" : "s"} remaining.`,
        ),
      ).toBeTruthy();
    }
    expect(checkLockout().isLocked).toBe(true);
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(decrypt).toHaveBeenCalledTimes(5);
    expect(mockCreated).not.toHaveBeenCalled();
    expect(mockCreateAccount).not.toHaveBeenCalled();
    expect(encryptSeedAsync).not.toHaveBeenCalled();
    expect(WalletEncryptionUtil.downloadWallet).not.toHaveBeenCalled();
  },
);
