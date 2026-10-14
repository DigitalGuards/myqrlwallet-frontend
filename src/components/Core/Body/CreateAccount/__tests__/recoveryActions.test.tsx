/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Web3BaseWalletAccount } from "@theqrl/web3";
import MnemonicDisplay from "../MnemonicDisplay/MnemonicDisplay";
import AccountImportSuccess from "../../ImportAccount/AccountImportSuccess/AccountImportSuccess";
import { copyToClipboard } from "@/utils/nativeApp";
import { WalletEncryptionUtil } from "@/utils/crypto";
import { logger } from "@/utils/log";

const mockNavigate = jest.fn(() => Promise.resolve());
const logError = jest.spyOn(logger, "error");
const download = jest.spyOn(WalletEncryptionUtil, "downloadWallet");
const address = `Q${"12".repeat(64)}`;
const seed = `0x${"12".repeat(48)}`;
const account: Web3BaseWalletAccount = {
  address,
  seed,
  sign: () => ({ messageHash: "0x", signature: "0x" }),
  signTransaction: () => Promise.reject(new Error("Signing is unused during backup")),
  encrypt: () => Promise.reject(new Error("Encryption is unused during backup")),
};
jest.mock("@/config", () => ({ getExplorerAddressUrl: () => "https://explorer.example/address" }));
jest.mock("@/stores/store", () => ({
  useStore: () => ({ qrlStore: { qrlConnection: { blockchain: "TEST_NET" } } }),
}));
jest.mock("@/utils/crypto", () => ({
  getMnemonicFromHexSeed: () => "synthetic mnemonic",
  WalletEncryptionUtil: { downloadWallet: jest.fn(() => Promise.resolve()) },
}));
jest.mock("@/utils/nativeApp", () => ({ copyToClipboard: jest.fn(() => Promise.resolve(true)) }));
jest.mock("@/utils/react", () => ({ withSuspense: () => () => null }));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/utils", () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(" ") }));
jest.mock("@/router/router", () => ({ ROUTES: { HOME: "/" } }));
jest.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("@/components/Core/Layout/PageShell", () => ({
  PageShell: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("@/utils/log", () => ({ logger: { error: jest.fn() } }));
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it.each([
  ["Copy Address", address, undefined, "Failed to copy address:"],
  ["Copy Mnemonic", "synthetic mnemonic", true, "Failed to copy mnemonic:"],
  ["Copy Hex Seed", seed, true, "Failed to copy hex seed:"],
] as const)(
  "preserves the clipboard sensitivity for %s and contains rejection",
  async (label, value, sensitive, message) => {
    const error = new Error("Clipboard unavailable");
    jest.mocked(copyToClipboard).mockRejectedValueOnce(error);
    render(<MnemonicDisplay account={account} userPassword="Password1!" />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => {
      expect(logError).toHaveBeenCalledWith(message, error);
    });
    if (sensitive === undefined) expect(copyToClipboard).toHaveBeenCalledWith(value);
    else expect(copyToClipboard).toHaveBeenCalledWith(value, sensitive);
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  },
);

it("preserves encrypted backup arguments and contains a download failure", async () => {
  const error = new Error("Download unavailable");
  download.mockRejectedValueOnce(error);
  render(<MnemonicDisplay account={account} userPassword="Password1!" />);
  fireEvent.click(screen.getByRole("button", { name: "Download Encrypted Wallet File" }));
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to download encrypted wallet:", error);
  });
  expect(download).toHaveBeenCalledWith(
    { ...account, mnemonic: "synthetic mnemonic", hexSeed: seed },
    "Password1!",
  );
});

it("preserves the confirmation before unencrypted backup", async () => {
  render(<MnemonicDisplay account={account} userPassword="Password1!" />);
  fireEvent.click(screen.getByRole("button", { name: "Download Unencrypted Wallet File" }));
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await waitFor(() => {
    expect(download).toHaveBeenCalledWith({
      ...account,
      mnemonic: "synthetic mnemonic",
      hexSeed: seed,
    });
  });
});

it("reports navigation rejection after the recovery confirmation", async () => {
  const error = new Error("Navigation failed");
  mockNavigate.mockRejectedValueOnce(error);
  render(<MnemonicDisplay account={account} userPassword="Password1!" />);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to open home:", error);
  });
  expect(mockNavigate).toHaveBeenCalledWith("/");
});

it("contains address-copy failure on the import success screen", async () => {
  const error = new Error("Clipboard unavailable");
  jest.mocked(copyToClipboard).mockRejectedValueOnce(error);
  render(<AccountImportSuccess account={{ address }} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to copy address:", error);
  });
  expect(copyToClipboard).toHaveBeenCalledWith(address);
});
