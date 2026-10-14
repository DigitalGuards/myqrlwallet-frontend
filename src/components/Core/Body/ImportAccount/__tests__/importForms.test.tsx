/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImportAccountForm } from "../ImportAccountForm/ImportAccountForm";
import { ImportHexSeedForm } from "../ImportHexSeedForm/ImportHexSeedForm";
import { ImportEncryptedWallet } from "../ImportEncryptedWallet/ImportEncryptedWallet";
import { deriveHexSeedAsync, getMnemonicFromHexSeed, WalletEncryptionUtil } from "@/utils/crypto";
import type { ImportedAccount } from "../importedAccount";

let mockDesktop = false;
let mockQrlAvailable = true;
const mockSeedToAccount = jest.fn<ImportedAccount, [string]>();
const mockImported = jest.fn((_account: ImportedAccount) => undefined);
const address = `Q${"12".repeat(64)}`;
const mnemonic = "synthetic recovery phrase";
const parseWallet = jest.spyOn(WalletEncryptionUtil, "parseEncryptedWallet");
const decryptWallet = jest.spyOn(WalletEncryptionUtil, "decryptWallet");
const hexSeed = `0x${"12".repeat(48)}`;

jest.mock("@/stores/store", () => ({
  useStore: () => ({
    qrlStore: {
      qrlInstance: mockQrlAvailable ? { accounts: { seedToAccount: mockSeedToAccount } } : null,
    },
  }),
}));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
}));
jest.mock("@/utils", () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(" ") }));
jest.mock("@/utils/crypto", () => ({
  deriveHexSeedAsync: jest.fn(),
  getMnemonicFromHexSeed: jest.fn(),
  MAX_WALLET_FILE_BYTES: 100000,
  MAX_WALLET_PASSWORD_LENGTH: 1024,
  looksLikeKeystoreBackup: () => false,
  WalletEncryptionUtil: { parseEncryptedWallet: jest.fn(), decryptWallet: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockDesktop = false;
  mockQrlAvailable = true;
  mockSeedToAccount.mockReturnValue({ address });
  jest.mocked(deriveHexSeedAsync).mockResolvedValue(hexSeed);
  jest.mocked(getMnemonicFromHexSeed).mockReturnValue(mnemonic);
  parseWallet.mockReturnValue({
    address,
    encryptedData: "fixture",
    salt: "fixture",
    iv: "fixture",
    version: "v2",
    timestamp: 1,
  });
  decryptWallet.mockResolvedValue({ address, mnemonic, hexSeed });
});
afterEach(cleanup);

async function submit(kind: "mnemonic" | "hex seed" | "file") {
  if (kind === "mnemonic") {
    render(<ImportAccountForm onAccountImported={mockImported} />);
    fireEvent.change(screen.getByPlaceholderText("Enter your mnemonic phrases"), {
      target: { value: mnemonic },
    });
  } else if (kind === "hex seed") {
    render(<ImportHexSeedForm onAccountImported={mockImported} />);
    fireEvent.change(screen.getByPlaceholderText("Enter your hex seed (0x...)"), {
      target: { value: hexSeed },
    });
  } else {
    render(<ImportEncryptedWallet onWalletImported={mockImported} />);
    const file = Object.assign(new File(["{}"], "wallet.json", { type: "application/json" }), {
      text: () => Promise.resolve("{}"),
    });
    const input = document.querySelector('input[type="file"]');
    if (!input) throw new Error("Wallet file input is missing");
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Import Wallet" }).hasAttribute("disabled")).toBe(
        false,
      );
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Password1!" } });
  }
  fireEvent.click(
    screen.getByRole("button", { name: kind === "file" ? "Import Wallet" : "Import Account" }),
  );
}

it.each(["mnemonic", "hex seed", "file"] as const)(
  "preserves the derived account and recovery data for a browser %s import",
  async (kind) => {
    const account = { address, marker: { retained: true } };
    mockSeedToAccount.mockReturnValue(account);
    await submit(kind);
    await waitFor(() => {
      expect(mockImported).toHaveBeenCalledTimes(1);
    });
    expect(mockImported).toHaveBeenCalledWith({ ...account, mnemonic, hexSeed });
    expect(mockImported.mock.calls[0]?.[0]).toBe(account);
    expect(mockSeedToAccount).toHaveBeenCalledWith(hexSeed);
  },
);

it.each(["mnemonic", "hex seed", "file"] as const)(
  "passes the same recovery placeholder to the desktop signer flow for %s",
  async (kind) => {
    mockDesktop = true;
    await submit(kind);
    await waitFor(() => {
      expect(mockImported).toHaveBeenCalledTimes(1);
    });
    const expected =
      kind === "mnemonic"
        ? { address: "", mnemonic }
        : kind === "hex seed"
          ? { address: "", hexSeed }
          : { address: "", mnemonic, hexSeed };
    expect(mockImported).toHaveBeenCalledWith(expected);
    expect(mockSeedToAccount).not.toHaveBeenCalled();
    expect(deriveHexSeedAsync).not.toHaveBeenCalled();
    expect(getMnemonicFromHexSeed).not.toHaveBeenCalled();
  },
);

it.each(["mnemonic", "hex seed", "file"] as const)(
  "fails closed when the account library is unavailable during %s import",
  async (kind) => {
    mockQrlAvailable = false;
    await submit(kind);
    await screen.findByText(
      kind === "mnemonic"
        ? "Invalid mnemonic phrases"
        : kind === "hex seed"
          ? "Invalid hex seed"
          : "Failed to decrypt wallet. Please check your password.",
    );
    expect(mockImported).not.toHaveBeenCalled();
  },
);

it("reports a rejected mnemonic derivation through the existing form error", async () => {
  jest.mocked(deriveHexSeedAsync).mockRejectedValueOnce(new Error("Derivation failed"));
  await submit("mnemonic");
  await screen.findByText("Invalid mnemonic phrases");
  expect(mockImported).not.toHaveBeenCalled();
});
