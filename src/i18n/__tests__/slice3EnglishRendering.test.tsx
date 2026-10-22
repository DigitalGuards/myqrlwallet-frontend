/** @jest-environment jsdom */
// English oracle: this harness is run unchanged on origin/dev
// 92aba99e5757198d9e8c9f6082b0cf518865a9ca. Only that source generates snapshots.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactElement, ComponentProps } from "react";
import { HelmetProvider } from "react-helmet-async";
import type { Web3BaseWalletAccount } from "@theqrl/web3";
import CreateAccount from "@/components/Core/Body/CreateAccount/CreateAccount";
import { AccountCreationForm } from "@/components/Core/Body/CreateAccount/AccountCreationForm/AccountCreationForm";
import MnemonicDisplay from "@/components/Core/Body/CreateAccount/MnemonicDisplay/MnemonicDisplay";
import MnemonicWordListing from "@/components/Core/Body/CreateAccount/MnemonicDisplay/MnemonicWordListing/MnemonicWordListing";
import ImportAccount from "@/components/Core/Body/ImportAccount/ImportAccount";
import { ImportAccountForm } from "@/components/Core/Body/ImportAccount/ImportAccountForm/ImportAccountForm";
import { ImportHexSeedForm } from "@/components/Core/Body/ImportAccount/ImportHexSeedForm/ImportHexSeedForm";
import { ImportEncryptedWallet } from "@/components/Core/Body/ImportAccount/ImportEncryptedWallet/ImportEncryptedWallet";
import AccountImportSuccess from "@/components/Core/Body/ImportAccount/AccountImportSuccess/AccountImportSuccess";
import AddAccount from "@/components/Core/Body/AddAccount/AddAccount";
import { PinSetup } from "@/components/Core/Body/PinSetup/PinSetup";
import { DeviceCredentialRecovery } from "@/components/Core/Body/PinSetup/DeviceCredentialRecovery";
import Legal from "@/components/Core/Body/Legal/Legal";
import Terms from "@/components/Core/Body/Terms/Terms";
import Privacy from "@/components/Core/Body/Privacy/Privacy";
import Security from "@/components/Core/Body/Security/Security";
import Disclaimer from "@/components/Core/Body/Disclaimer/Disclaimer";
import { CryptoOperationError, CryptoErrorCode } from "@/utils/crypto";
import { PinVerificationError } from "@/utils/crypto/verifyPinWithLimit";
import { deferred } from "@/test-utils/deferred";
import { applyLanguage } from "../index";

const ADDRESS = `Q${"1".repeat(128)}`;
const SEED = `0x${"12".repeat(48)}`;
// Synthetic display data, never an account with funds.
const PHRASE = "synthetic recovery words";
const account: Web3BaseWalletAccount = {
  address: ADDRESS,
  seed: SEED,
  sign: () => ({ messageHash: "0x", signature: "0x" }),
  signTransaction: () => Promise.reject(new Error("Unused fixture")),
  encrypt: () => Promise.reject(new Error("Unused fixture")),
};
let mockNative = false;
let mockDesktop = false;
let mockLimit = false;
let mockMnemonic = PHRASE;
let mockExtension = false;
let mockSettingsAvailable = true;
const mockSeeds = jest.fn<Promise<unknown[]>, []>();
const mockCreate = jest.fn<unknown, []>();
const mockDerive = jest.fn<Promise<string>, []>();
const mockSeedAccount = jest.fn<unknown, []>();
const mockEncrypt = jest.fn<Promise<string>, []>();
const mockVerify = jest.fn<Promise<unknown>, []>();
const mockProvision = jest.fn<Promise<unknown>, []>();
const mockParse = jest.fn<unknown, []>();
const mockParseKeystores = jest.fn<unknown[], []>();
const mockDecrypt = jest.fn<Promise<unknown>, []>();
const mockComplete = jest.fn<Promise<void>, []>();
const mockImported = jest.fn(() => undefined);
const mockCopy = jest.fn<Promise<boolean>, [string, boolean?]>();
const mockPinChanges = new Map<string, (value: string) => void>();
const mockStore = {
  qrlStore: {
    qrlConnection: { blockchain: "TEST_NET", isConnected: true },
    qrlInstance: {
      accounts: {
        create: () => mockCreate(),
        seedToAccount: () => mockSeedAccount(),
      },
    },
    setActiveAccount: () => Promise.resolve(),
  },
};
jest.mock("react-helmet-async", () => {
  const actual =
    jest.requireActual<typeof import("react-helmet-async")>(
      "react-helmet-async",
    );
  return {
    ...actual,
    Helmet: (props: ComponentProps<typeof actual.Helmet>) => (
      <actual.Helmet {...props} defer={false} />
    ),
  };
});
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
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
    ACCOUNT_LIST: "/account-list",
    TERMS: "/terms",
    PRIVACY: "/privacy",
    SECURITY: "/security",
    LEGAL: "/legal",
    DISCLAIMER: "/disclaimer",
  },
}));
jest.mock("@/config", () => ({
  getExplorerAddressUrl: () => "https://explorer.example/address",
}));
jest.mock("@/config/runtimeProfile", () => ({
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/hooks/useWalletLimit", () => ({
  useWalletLimit: () => ({
    isWalletLimitReached: mockLimit,
    walletCount: mockLimit ? 10 : 1,
    maxWallets: 10,
  }),
}));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: {
    createWallet: () => mockProvision(),
    importWallet: () => mockProvision(),
  },
}));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => mockNative,
  notifySeedStored: () => Promise.resolve(),
  copyToClipboard: (value: string, sensitive?: boolean) =>
    mockCopy(value, sensitive),
  openExternalUrl: jest.fn(),
  openNativeSettings: () => mockSettingsAvailable,
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getAllEncryptedSeeds: () => mockSeeds(),
    storeEncryptedSeed: () => Promise.resolve({ revision: 1 }),
  },
}));
jest.mock("@/utils/crypto", () => ({
  CryptoOperationError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  CryptoErrorCode: {
    OUTDATED_FORMAT: "OUTDATED_FORMAT",
    DEVICE_CREDENTIAL_UNAVAILABLE: "DEVICE_CREDENTIAL_UNAVAILABLE",
    INVALID_DATA: "INVALID_DATA",
  },
  getMnemonicFromHexSeed: () => mockMnemonic,
  deriveHexSeedAsync: () => mockDerive(),
  encryptSeedAsync: () => mockEncrypt(),
  decryptStoredSeedAsync: jest.fn(),
  MAX_WALLET_FILE_BYTES: 100000,
  MAX_WALLET_PASSWORD_LENGTH: 1024,
  looksLikeKeystoreBackup: () => mockExtension,
  parseKeystoreBackup: () => mockParseKeystores(),
  decryptKeystoreAsync: () => mockDecrypt(),
  WalletEncryptionUtil: {
    downloadWallet: () => Promise.resolve(),
    parseEncryptedWallet: () => mockParse(),
    decryptWallet: () => mockDecrypt(),
  },
}));
jest.mock("@/utils/crypto/verifyPinWithLimit", () => ({
  ...jest.requireActual<typeof import("@/utils/crypto/verifyPinWithLimit")>(
    "@/utils/crypto/verifyPinWithLimit",
  ),
  verifyPinWithLimit: () => mockVerify(),
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: {
    captureGeneration: () => 0,
    isCurrent: () => true,
    enqueueWalletMutation: (
      work: (current: (() => boolean) & { epoch: string }) => Promise<void>,
    ) => work(Object.assign(() => true, { epoch: "fixture" })),
  },
}));
jest.mock(
  "@/components/Core/Body/Home/AccountCreateImport/AccountCreateImport",
  () => ({ __esModule: true, default: () => null }),
);
jest.mock("@/components/UI/PinInput/PinInput", () => {
  const actual = jest.requireActual<
    typeof import("@/components/UI/PinInput/PinInput")
  >("@/components/UI/PinInput/PinInput");
  return {
    ...actual,
    PinInput: (props: ComponentProps<typeof actual.PinInput>) => {
      mockPinChanges.set(props.placeholder ?? "", props.onChange);
      return <actual.PinInput {...props} />;
    },
  };
});
jest.mock("@/utils/log", () => ({
  logger: { error: jest.fn(), warn: jest.fn() },
}));

class ResizeObserverFixture {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(async () => {
  jest.resetAllMocks();
  mockNative = false;
  mockDesktop = false;
  mockLimit = false;
  mockExtension = false;
  mockMnemonic = PHRASE;
  mockSettingsAvailable = true;
  mockPinChanges.clear();
  mockSeeds.mockResolvedValue([]);
  mockCreate.mockReturnValue(account);
  mockSeedAccount.mockImplementation(() => ({ address: ADDRESS }));
  mockDerive.mockResolvedValue(SEED);
  mockEncrypt.mockResolvedValue("encrypted fixture");
  mockVerify.mockResolvedValue({});
  mockProvision.mockResolvedValue({
    address: ADDRESS,
    status: { address: ADDRESS },
    mnemonic: PHRASE,
  });
  mockComplete.mockResolvedValue();
  mockCopy.mockResolvedValue(true);
  mockParse.mockReturnValue({ version: "v2" });
  mockParseKeystores.mockReturnValue([
    { crypto: { kdfparams: { m: 1 } } },
    { address: ADDRESS, crypto: { kdfparams: { m: 300000 } } },
  ]);
  mockDecrypt.mockResolvedValue({ hexSeed: SEED, mnemonic: PHRASE });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: jest.fn(),
  });
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: jest.fn(),
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverFixture,
  });
  await applyLanguage("en");
});
afterEach(() => {
  cleanup();
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
    .forEach((node) => {
      node.remove();
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
    // Include document metadata as well as the visible and accessibility copy.
    title: document.title,
    meta: [
      ...document.head.querySelectorAll(
        'meta[name="description"], meta[name="keywords"]',
      ),
    ].map((element) => [
      element.getAttribute("name"),
      element.getAttribute("content"),
    ]),
  }).toMatchSnapshot();
}
async function click(name: string) {
  await act(async () => {
    fireEvent.click(
      screen.getAllByRole("button", { name })[0] ??
        (() => {
          throw new Error("Missing button");
        })(),
    );
    await Promise.resolve();
  });
}
async function fill(placeholder: string, value: string) {
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText(placeholder), {
      target: { value },
    });
    await Promise.resolve();
  });
}
async function pin(name: string, value: string) {
  await act(async () => {
    const change = mockPinChanges.get(name);
    if (!change) throw new Error(`Missing PIN field: ${name}`);
    change(value);
    await Promise.resolve();
  });
}
async function submit() {
  const form = document.querySelector("form");
  if (!form) throw new Error("Missing form");
  await act(async () => {
    fireEvent.submit(form);
    await Promise.resolve();
  });
}
const creation = () => <AccountCreationForm onAccountCreated={mockComplete} />;
const pinSetup = () => (
  <PinSetup
    accountAddress={ADDRESS}
    mnemonic={PHRASE}
    hexSeed={SEED}
    onPinSetupComplete={mockComplete}
  />
);
async function validCreation(existing = false) {
  await fill("Password", "Password1!");
  await fill("Re-enter the password", "Password1!");
  if (!mockDesktop) {
    await pin(
      existing ? "Your existing PIN" : "Enter PIN (4-6 digits)",
      "123456",
    );
    if (!existing) await pin("Re-enter PIN", "123456");
  }
}
async function upload(
  content = "{}",
  name = "wallet.json",
  type = "application/json",
  size?: number,
) {
  const file = Object.assign(new File([content], name, { type }), {
    text: () => Promise.resolve(content),
  });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("Missing file input");
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
    await Promise.resolve();
  });
}

it.each(["web", "native", "desktop"])(
  "%s creation, add account and PIN setup",
  async (platform) => {
    mockNative = platform === "native";
    mockDesktop = platform === "desktop";
    await show(<CreateAccount />);
    snapshot();
    cleanup();
    await show(<AddAccount />);
    snapshot();
    cleanup();
    await show(pinSetup());
    snapshot();
  },
);
it.each([false, true])(
  "existing=%s creation and PIN entry",
  async (existing) => {
    mockSeeds.mockResolvedValue(
      existing ? [{ address: ADDRESS, encryptedSeed: "fixture" }] : [],
    );
    await show(creation());
    snapshot();
    cleanup();
    await show(pinSetup());
    snapshot();
  },
);
it("creation and import wallet limits", async () => {
  mockLimit = true;
  await show(<CreateAccount />);
  snapshot();
  cleanup();
  await show(<ImportAccount />);
  snapshot();
});
it("creation and PIN loading; creation inventory failure", async () => {
  const pending = deferred<unknown[]>();
  mockSeeds.mockReturnValue(pending.promise);
  await show(creation());
  snapshot();
  cleanup();
  await show(pinSetup());
  snapshot();
  cleanup();
  mockSeeds.mockRejectedValue(new Error("Storage unavailable"));
  await show(creation());
  snapshot();
});
it.each([
  ["short", "Password must be at least 8 characters"],
  ["password1!", "Password must contain at least one uppercase letter"],
  ["PASSWORD1!", "Password must contain at least one lowercase letter"],
  ["Password!", "Password must contain at least one number"],
  ["Password1", "Password must contain at least one special character"],
])("password validation: %s", async (password, error) => {
  for (const desktop of [false, true]) {
    mockDesktop = desktop;
    await show(desktop ? pinSetup() : creation());
    await fill("Password", password);
    await screen.findByText(new RegExp(error));
    snapshot();
    cleanup();
  }
});
it("password confirmation required and mismatch", async () => {
  for (const desktop of [false, true]) {
    mockDesktop = desktop;
    await show(desktop ? pinSetup() : creation());
    await fill("Password", "Password1!");
    await submit();
    snapshot();
    await fill("Re-enter the password", "Password2!");
    snapshot();
    cleanup();
  }
});
it.each(["123", "1234567", "abcd"])("PIN validation: %s", async (value) => {
  for (const element of [creation(), pinSetup()]) {
    await show(element);
    await pin("Enter PIN (4-6 digits)", value);
    snapshot();
    cleanup();
  }
});
it("PIN confirmation mismatch", async () => {
  for (const element of [creation(), pinSetup()]) {
    await show(element);
    await pin("Enter PIN (4-6 digits)", "123456");
    await pin("Re-enter PIN", "654321");
    snapshot();
    cleanup();
  }
});
for (const kind of [
  "incorrect",
  "last-attempt",
  "locked",
  "busy",
  "outdated",
  "credential",
  "unknown",
] as const) {
  it(`existing PIN error: ${kind}`, async () => {
    mockSeeds.mockResolvedValue([
      { address: ADDRESS, encryptedSeed: "fixture" },
    ]);
    const error =
      kind === "incorrect" ||
      kind === "last-attempt" ||
      kind === "locked" ||
      kind === "busy"
        ? new PinVerificationError(
            {
              isLocked: kind === "locked",
              remainingMs: 900000,
              attemptsLeft: kind === "last-attempt" ? 1 : 4,
            },
            kind === "busy"
              ? "Another PIN check is still running. Please try again."
              : undefined,
          )
        : kind === "outdated" || kind === "credential"
          ? new CryptoOperationError(
              kind === "outdated"
                ? CryptoErrorCode.OUTDATED_FORMAT
                : CryptoErrorCode.DEVICE_CREDENTIAL_UNAVAILABLE,
              "fixture",
            )
          : new Error("Unknown service failure");
    mockVerify.mockRejectedValue(error);
    await show(creation());
    await validCreation(true);
    await submit();
    snapshot();
    cleanup();
    await show(pinSetup());
    await pin("Enter your existing PIN", "123456");
    await submit();
    snapshot();
  });
}
it.each(["Error", "string", "null"])(
  "creation and PIN service rejection: %s",
  async (kind) => {
    const error =
      kind === "Error"
        ? new Error("Service detail")
        : kind === "string"
          ? "raw service detail"
          : null;
    mockEncrypt.mockRejectedValue(error);
    await show(creation());
    await validCreation();
    await submit();
    snapshot();
    cleanup();
    await show(pinSetup());
    await pin("Enter PIN (4-6 digits)", "123456");
    await pin("Re-enter PIN", "123456");
    await submit();
    snapshot();
    cleanup();
    mockDesktop = true;
    mockProvision.mockRejectedValue(error);
    await show(creation());
    await validCreation();
    await submit();
    snapshot();
    cleanup();
    await show(pinSetup());
    await fill("Password", "Password1!");
    await fill("Re-enter the password", "Password1!");
    await submit();
    snapshot();
  },
);
it.each(["account", "mnemonic"])("creation failure: %s", async (kind) => {
  if (kind === "account") mockCreate.mockReturnValue(undefined);
  else mockMnemonic = "";
  await show(creation());
  await validCreation();
  await submit();
  snapshot();
});
it("creation encrypting, creating, PIN encrypting and desktop importing", async () => {
  const pending = deferred<string>();
  mockEncrypt.mockReturnValue(pending.promise);
  await show(creation());
  await validCreation();
  await submit();
  snapshot();
  cleanup();
  await show(pinSetup());
  await pin("Enter PIN (4-6 digits)", "123456");
  await pin("Re-enter PIN", "123456");
  await submit();
  snapshot();
  cleanup();
  mockDesktop = true;
  mockProvision.mockReturnValue(deferred<unknown>().promise);
  await show(pinSetup());
  await fill("Password", "Password1!");
  await fill("Re-enter the password", "Password1!");
  await submit();
  snapshot();
  cleanup();
  mockDesktop = false;
  mockCreate.mockReturnValue(deferred<unknown>().promise);
  await show(creation());
  await validCreation();
  await submit();
  snapshot();
});
it.each(["web", "desktop", "empty"])(
  "recovery display and dialogs: %s",
  async (platform) => {
    mockDesktop = platform === "desktop";
    if (platform === "empty") mockMnemonic = "";
    await show(
      <MnemonicDisplay
        account={platform === "empty" ? undefined : account}
        userPassword="Password1!"
        desktopBackup={{ address: ADDRESS, mnemonic: PHRASE }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    snapshot();
    await click("View QR");
    snapshot();
    await click("Close");
    if (!mockDesktop) {
      await click("Download Unencrypted Wallet File");
      snapshot();
      await click("Cancel");
    }
    await click("Done");
    snapshot();
  },
);
it.each(["Copy Address", "Copy Mnemonic", "Copy Hex Seed"])(
  "recovery copied state: %s",
  async (label) => {
    await show(<MnemonicDisplay account={account} userPassword="Password1!" />);
    await click(label);
    snapshot();
  },
);
it.each(["", PHRASE])("recovery words: %s", async (mnemonic) => {
  await show(<MnemonicWordListing mnemonic={mnemonic} />);
  snapshot();
});
it.each([false, true])("import success empty=%s and copied", async (empty) => {
  await show(
    <AccountImportSuccess account={empty ? undefined : { address: ADDRESS }} />,
  );
  snapshot();
  await click("Copy");
  snapshot();
});
it.each([
  "Import with Mnemonic",
  "Import Encrypted Wallet",
  "Import with Hex Seed",
])("import tab: %s", async (name) => {
  await show(<ImportAccount />);
  const tab = screen.getByRole("tab", { name });
  await act(async () => {
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
    fireEvent.keyDown(tab, { key: "Enter" });
    await Promise.resolve();
  });
  snapshot();
});
it.each(["mnemonic", "hex"])(
  "import required, malformed, service failure and busy: %s",
  async (kind) => {
    await show(
      kind === "mnemonic" ? (
        <ImportAccountForm onAccountImported={mockImported} />
      ) : (
        <ImportHexSeedForm onAccountImported={mockImported} />
      ),
    );
    snapshot();
    await submit();
    snapshot();
    const placeholder =
      kind === "mnemonic"
        ? "Enter your mnemonic phrases"
        : "Enter your hex seed (0x...)";
    if (kind === "hex") {
      await fill(placeholder, "invalid");
      await submit();
      snapshot();
    }
    mockDerive.mockRejectedValue(new Error("Malformed phrase"));
    mockSeedAccount.mockReturnValue(undefined);
    await fill(placeholder, kind === "mnemonic" ? PHRASE : SEED);
    await submit();
    snapshot();
    if (kind === "mnemonic") {
      mockDerive.mockReturnValue(deferred<string>().promise);
      await submit();
      snapshot();
    } else {
      mockSeedAccount.mockReturnValue({ address: ADDRESS });
      mockMnemonic = "";
      await submit();
      snapshot();
    }
  },
);
it("import wallet file selection and validation", async () => {
  await show(<ImportEncryptedWallet onWalletImported={mockImported} />);
  snapshot();
  await submit();
  snapshot();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Password1!" },
    });
    await Promise.resolve();
  });
  await submit();
  snapshot();
  await upload("{}", "wallet.json", "application/json", 100001);
  snapshot();
  await upload("{}", "wallet.txt", "text/plain");
  snapshot();
  await upload("not json");
  snapshot();
  mockParse.mockImplementation(() => {
    throw new Error("Invalid format");
  });
  await upload();
  snapshot();
});
it("wallet file password too long, decrypting and failures", async () => {
  await show(<ImportEncryptedWallet onWalletImported={mockImported} />);
  await upload();
  snapshot();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "x".repeat(1025) },
    });
    await Promise.resolve();
  });
  await submit();
  snapshot();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Password1!" },
    });
    await Promise.resolve();
  });
  mockDecrypt.mockRejectedValue(new Error("Wrong password"));
  await submit();
  snapshot();
  mockDecrypt.mockReturnValue(deferred<unknown>().promise);
  await submit();
  snapshot();
});
it("extension file accounts, memory warning, decrypt error and empty keystores", async () => {
  mockExtension = true;
  await show(<ImportEncryptedWallet onWalletImported={mockImported} />);
  await upload();
  snapshot();
  // Select the second account with its high-memory warning using the real Radix menu.
  await act(async () => {
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    await Promise.resolve();
  });
  snapshot();
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name: /Q1111/ }));
    await Promise.resolve();
  });
  snapshot();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Password1!" },
    });
    await Promise.resolve();
  });
  mockDecrypt.mockRejectedValue(new Error("Wrong password"));
  await submit();
  snapshot();
  mockDecrypt.mockRejectedValue(
    new CryptoOperationError(
      CryptoErrorCode.INVALID_DATA,
      "Unsupported derived-key length (only dklen 32 / AES-256 is supported).",
    ),
  );
  await submit();
  snapshot();
  mockParseKeystores.mockReturnValue([]);
  await upload();
  await submit();
  snapshot();
});
it.each([false, true])("device recovery native=%s", async (native) => {
  mockNative = native;
  await show(<DeviceCredentialRecovery />);
  snapshot();
  if (native) {
    mockSettingsAvailable = false;
    await click("Open app settings");
    snapshot();
  }
});
it.each([Legal, Terms, Privacy, Security, Disclaimer])(
  "English legal content: %p",
  async (Component) => {
    await show(<Component />);
    snapshot();
  },
);
it("complete create/import route transitions", async () => {
  await show(<CreateAccount />);
  await validCreation();
  await submit();
  await screen.findByText("Your Recovery Information");
  snapshot();
  cleanup();
  await show(<ImportAccount />);
  await fill("Enter your mnemonic phrases", PHRASE);
  await submit();
  await screen.findByText("Set Transaction PIN");
  snapshot();
  await pin("Enter PIN (4-6 digits)", "123456");
  await pin("Re-enter PIN", "123456");
  await submit();
  await screen.findByText("Account imported");
  snapshot();
});

it.each([
  "Invalid keystore backup file.",
  "Invalid hex in keystore salt.",
  "Invalid keystore #2: not an object.",
  "Unsupported keystore #2 version (expected 1).",
  "Invalid keystore #2: missing crypto section.",
  "Unsupported cipher in keystore #2 (expected aes-256-gcm).",
  "Unsupported KDF in keystore #2 (expected argon2id).",
  "Invalid keystore #2: missing cipherparams.",
  "Invalid IV in keystore #2 (expected 12 bytes of hex).",
  "Invalid ciphertext in keystore #2.",
  "Invalid keystore #2: missing kdfparams.",
  "KDF parameters in keystore #2 are outside the accepted bounds.",
  "Invalid salt in keystore #2.",
  "Invalid metadata in keystore #2.",
  "The backup file contains more than 10 keystores.",
  "Decrypted seed has an unsupported length (52 bytes; expected 51).",
  "Unrecognized service detail: 0xABC",
])("wallet file parser error: %s", async (message) => {
  mockExtension = true;
  mockParseKeystores.mockImplementation(() => {
    throw Object.assign(new Error(message), { name: "KeystoreFormatError" });
  });
  await show(<ImportEncryptedWallet onWalletImported={mockImported} />);
  await upload();
  snapshot();
});
it("wallet file parsing state", async () => {
  await show(<ImportEncryptedWallet onWalletImported={mockImported} />);
  const pending = deferred<string>();
  const file = Object.assign(
    new File(["{}"], "pending.json", { type: "application/json" }),
    { text: () => pending.promise },
  );
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("Missing file input");
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
    await Promise.resolve();
  });
  snapshot();
});

it.each([
  "The native device credential is invalid.",
  "This wallet cannot be opened because its device security credential is unavailable.",
  "Secure browser storage is unavailable. Wallet creation has been stopped.",
  "Secure browser storage could not be opened. Wallet creation has been stopped.",
  "Secure browser storage is blocked by another wallet tab.",
  "The secure browser credential is corrupt or has an unsupported format.",
  "The secure browser credential could not be read.",
  "The secure browser credential was not durably stored.",
  "The secure browser credential could not be durably stored.",
  "The secure browser credential write was interrupted.",
  "Another wallet tab created a device credential, but it could not be loaded.",
  "Native secure storage failed.",
  "Invalid PIN format",
  "Unknown crypto error",
  "Invalid crypto worker response",
  "Worker error",
  "Wallet identity changed before sensitive storage write",
  "Wallet identity changed during sensitive storage write",
])(
  "credential/storage failure during creation and PIN setup: %s",
  async (message) => {
    mockEncrypt.mockRejectedValue(
      Object.assign(new Error(message), { name: "CryptoOperationError" }),
    );
    await show(creation());
    await validCreation();
    await submit();
    snapshot();
    cleanup();
    await show(pinSetup());
    await pin("Enter PIN (4-6 digits)", "123456");
    await pin("Re-enter PIN", "123456");
    await submit();
    snapshot();
  },
);
