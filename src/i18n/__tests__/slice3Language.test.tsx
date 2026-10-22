/** @jest-environment jsdom */
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
import type { Web3BaseWalletAccount } from "@theqrl/web3";
import { ImportAccountForm } from "@/components/Core/Body/ImportAccount/ImportAccountForm/ImportAccountForm";
import { ImportEncryptedWallet } from "@/components/Core/Body/ImportAccount/ImportEncryptedWallet/ImportEncryptedWallet";
import MnemonicDisplay from "@/components/Core/Body/CreateAccount/MnemonicDisplay/MnemonicDisplay";
import { DeviceCredentialRecovery } from "@/components/Core/Body/PinSetup/DeviceCredentialRecovery";
import { PinSetup } from "@/components/Core/Body/PinSetup/PinSetup";
import Legal from "@/components/Core/Body/Legal/Legal";
import Terms from "@/components/Core/Body/Terms/Terms";
import Privacy from "@/components/Core/Body/Privacy/Privacy";
import Security from "@/components/Core/Body/Security/Security";
import Disclaimer from "@/components/Core/Body/Disclaimer/Disclaimer";
import { PinVerificationError } from "@/utils/crypto/verifyPinWithLimit";
import { applyLanguage, i18n } from "../index";
import { onboardingError, onboardingMessage } from "../onboardingMessage";
import en from "@/locales/en/onboarding.json";
import type { Language } from "../languages";

const ADDRESS = `Q${"1".repeat(128)}`;
const HEX = `0x${"12".repeat(51)}`;
const WORDS = "synthetic recovery words";
const mockDerive = jest.fn<Promise<string>, [string]>();
const mockVerify = jest.fn<Promise<unknown>, []>();
const mockEncrypt = jest.fn<Promise<string>, []>();
const mockCopy = jest.fn<Promise<boolean>, [string, boolean?]>();
let mockNative = false;
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("@/stores/store", () => ({
  useStore: () => ({
    qrlStore: {
      qrlConnection: { blockchain: "TEST_NET" },
      qrlInstance: {
        accounts: { seedToAccount: () => ({ address: `Q${"1".repeat(128)}` }) },
      },
    },
  }),
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/config", () => ({}));
jest.mock("@/config/runtimeProfile", () => ({
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/router/router", () => ({
  ROUTES: {
    HOME: "/",
    TERMS: "/terms",
    PRIVACY: "/privacy",
    LEGAL: "/legal",
    SECURITY: "/security",
    DISCLAIMER: "/disclaimer",
  },
}));
jest.mock("react-router", () => ({
  useNavigate: () => jest.fn(),
  Link: ({
    to,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props} />
  ),
}));
jest.mock("@/utils/crypto", () => ({
  CryptoOperationError: class extends Error {},
  CryptoErrorCode: {},
  deriveHexSeedAsync: (value: string) => mockDerive(value),
  getMnemonicFromHexSeed: () => "synthetic recovery words",
  encryptSeedAsync: () => mockEncrypt(),
  decryptStoredSeedAsync: jest.fn(),
  MAX_WALLET_FILE_BYTES: 100000,
  MAX_WALLET_PASSWORD_LENGTH: 1024,
  looksLikeKeystoreBackup: () => false,
  WalletEncryptionUtil: {
    downloadWallet: jest.fn(),
    parseEncryptedWallet: () => {
      throw new Error("bad file");
    },
  },
}));
jest.mock("@/utils/crypto/verifyPinWithLimit", () => ({
  ...jest.requireActual<typeof import("@/utils/crypto/verifyPinWithLimit")>(
    "@/utils/crypto/verifyPinWithLimit",
  ),
  verifyPinWithLimit: () => mockVerify(),
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getAllEncryptedSeeds: () =>
      Promise.resolve([
        { address: `Q${"1".repeat(128)}`, encryptedSeed: "fixture" },
      ]),
  },
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: { captureGeneration: () => 0 },
}));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => mockNative,
  openNativeSettings: () => false,
  copyToClipboard: (value: string, sensitive?: boolean) =>
    mockCopy(value, sensitive),
}));
jest.mock("@/utils/log", () => ({ logger: { error: jest.fn() } }));

const translate = () =>
  i18n.getFixedT(null, ["onboarding", "common", "settings"] as const);
const switchTo = (language: Language) => act(() => applyLanguage(language));
async function show(element: ReactElement) {
  await act(async () => {
    render(<HelmetProvider>{element}</HelmetProvider>);
    await Promise.resolve();
  });
}
beforeEach(async () => {
  jest.clearAllMocks();
  mockNative = false;
  mockDerive.mockRejectedValue(new Error("invalid fixture phrase"));
  mockVerify.mockRejectedValue(
    new PinVerificationError({
      isLocked: false,
      remainingMs: 0,
      attemptsLeft: 4,
    }),
  );
  mockCopy.mockResolvedValue(true);
  await applyLanguage("en");
});
afterEach(async () => {
  cleanup();
  await applyLanguage("en");
});

it.each(["de", "es", "ru", "zh-CN"] as const)(
  "%s translates existing form errors without rerunning imports or PIN checks",
  async (language) => {
    const complete = jest.fn();
    await show(<ImportAccountForm onAccountImported={complete} />);
    fireEvent.change(screen.getByPlaceholderText(en.mnemonicPlaceholder), {
      target: { value: WORDS },
    });
    fireEvent.click(screen.getByRole("button", { name: en.importTitle }));
    await screen.findByText(en.mnemonicInvalid);
    await switchTo(language);
    expect(
      screen.getByText(translate()("onboarding:mnemonicInvalid")),
    ).toBeTruthy();
    expect(
      screen.getByPlaceholderText<HTMLInputElement>(
        translate()("onboarding:mnemonicPlaceholder"),
      ).value,
    ).toBe(WORDS);
    expect(mockDerive).toHaveBeenCalledTimes(1);
    expect(mockDerive).toHaveBeenCalledWith(WORDS);
    expect(complete).not.toHaveBeenCalled();
    cleanup();
    await switchTo("en");
    await show(
      <PinSetup
        accountAddress={ADDRESS}
        mnemonic={WORDS}
        hexSeed={HEX}
        onPinSetupComplete={complete}
      />,
    );
    await act(async () => {
      for (let i = 1; i <= 6; i++)
        fireEvent.change(screen.getByLabelText(`PIN digit ${i}`), {
          target: { value: "9" },
        });
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: en.importWallet }));
    await screen.findByText("Incorrect PIN. 4 attempts remaining.");
    await switchTo(language);
    expect(
      screen.getByText(translate()("settings:incorrectPin", { count: 4 })),
    ).toBeTruthy();
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockEncrypt).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  },
);
it.each(["de", "es", "ru", "zh-CN"] as const)(
  "%s preserves recovery words, seed bytes, clipboard sensitivity and full warnings",
  async (language) => {
    await switchTo(language);
    const account: Web3BaseWalletAccount = {
      address: ADDRESS,
      seed: HEX,
      sign: () => ({ messageHash: "0x", signature: "0x" }),
      signTransaction: () => Promise.reject(new Error("unused")),
      encrypt: () => Promise.reject(new Error("unused")),
    };
    await show(<MnemonicDisplay account={account} userPassword="Password1!" />);
    await screen.findByText("synthetic");
    for (const word of WORDS.split(" "))
      expect(screen.getByText(word)).toBeTruthy();
    const t = translate();
    fireEvent.click(
      screen.getByRole("button", { name: t("onboarding:copyMnemonic") }),
    );
    await waitFor(() => {
      expect(mockCopy).toHaveBeenCalledWith(WORDS, true);
    });
    fireEvent.click(
      screen.getByRole("button", { name: t("onboarding:copyHex") }),
    );
    await waitFor(() => {
      expect(mockCopy).toHaveBeenCalledWith(HEX, true);
    });
    fireEvent.click(
      screen.getByRole("button", { name: t("onboarding:downloadUnencrypted") }),
    );
    expect(screen.getByText(t("onboarding:unencryptedWarning"))).toBeTruthy();
    cleanup();
    await show(<DeviceCredentialRecovery />);
    for (const key of [
      "onboarding:recoveryBackups",
      "onboarding:recoveryRetryBrowser",
      "onboarding:recoveryBrowser",
    ] as const)
      expect(screen.getByText(t(key))).toBeTruthy();
    cleanup();
    mockNative = true;
    await show(<DeviceCredentialRecovery />);
    expect(screen.getByText(t("onboarding:recoveryNative"))).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: t("onboarding:openAppSettings") }),
    );
    expect(screen.getByText(t("onboarding:settingsFallback"))).toBeTruthy();
  },
);
it.each([Legal, Terms, Privacy, Security, Disclaimer])(
  "%p keeps legal copy English and adds only the translated note",
  async (Component) => {
    await show(<Component />);
    const english = document.body.textContent;
    for (const language of ["de", "es", "ru", "zh-CN"] as const) {
      await switchTo(language);
      const note = i18n.t("common:englishOnly");
      expect(screen.getByText(note)).toBeTruthy();
      expect(document.body.textContent.replace(note, "")).toBe(english);
    }
    await switchTo("en");
    expect(document.body.textContent).toBe(english);
  },
);
it("file errors follow language changes and preserve filenames", async () => {
  await show(<ImportEncryptedWallet onWalletImported={jest.fn()} />);
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("Missing file input");
  const file = Object.assign(
    new File(["invalid"], "original-wallet.json", { type: "application/json" }),
    { text: () => Promise.resolve("invalid") },
  );
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText(en.fileInvalid);
  await switchTo("zh-CN");
  expect(screen.getByText(translate()("onboarding:fileInvalid"))).toBeTruthy();
  expect(screen.getByText("original-wallet.json")).toBeTruthy();
});
it("translates owned service errors while retaining unknown data and original English", async () => {
  const t = translate();
  const serviceKeys = [
    "keystoreObject",
    "keystoreVersion",
    "keystoreCrypto",
    "keystoreCipher",
    "keystoreKdf",
    "keystoreCipherparams",
    "keystoreIv",
    "keystoreCiphertext",
    "keystoreKdfparams",
    "keystoreBounds",
    "keystoreSalt",
    "keystoreMetadata",
    "keystoreLimit",
    "keystoreKeyLength",
    "keystoreSeedLength",
    "keystoreHex",
  ] as const;
  const values = {
    number: "2",
    limit: "10",
    length: "52",
    expected: "51",
    field: "IV",
  };
  const format = (text: string) =>
    text.replace(
      /{{(\w+)}}/g,
      (_match, name: string) =>
        Object.entries(values).find(([key]) => key === name)?.[1] ?? "",
    );
  for (const key of serviceKeys)
    expect(onboardingMessage(format(en[key]), t)).toBe(format(en[key]));
  for (const language of ["de", "es", "ru", "zh-CN"] as const) {
    await switchTo(language);
    const translated = translate();
    for (const key of serviceKeys)
      expect(onboardingMessage(format(en[key]), translated)).toBe(
        translated(`onboarding:${key}`, values),
      );
    const external = "Signer detail <code> & 0xAB12";
    expect(onboardingMessage(external, translated)).toBe(external);
    expect(
      onboardingMessage(
        onboardingError({ key: "onboarding:importFailed", reason: external }),
        translated,
      ),
    ).toBe(translated("onboarding:importFailed", { reason: external }));
  }
});

it.each(["de", "es", "ru", "zh-CN"] as const)(
  "%s translates device storage failure details inside a stored form error",
  async (language) => {
    await switchTo(language);
    const t = translate();
    const message = onboardingError({
      key: "onboarding:setupFailed",
      reason:
        "CryptoOperationError: Secure browser storage is unavailable. Wallet creation has been stopped.",
    });
    expect(onboardingMessage(message, t)).toBe(
      t("onboarding:setupFailed", {
        reason: t("onboarding:cryptoErrorReason", {
          reason: t("onboarding:secureStorageUnavailable"),
        }),
      }),
    );
  },
);
