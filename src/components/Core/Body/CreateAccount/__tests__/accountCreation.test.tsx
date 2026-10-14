/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountCreationForm } from "../AccountCreationForm/AccountCreationForm";
import { StorageUtil } from "@/utils/storage";
import { encryptSeedAsync } from "@/utils/crypto";
import { notifySeedStored } from "@/utils/nativeApp";
import { logger } from "@/utils/log";

const logError = jest.spyOn(logger, "error");

const getSeeds = jest.spyOn(StorageUtil, "getAllEncryptedSeeds");
const storeSeed = jest.spyOn(StorageUtil, "storeEncryptedSeed");
const address = `Q${"12".repeat(64)}`;
const hexSeed = `0x${"12".repeat(48)}`;
const mockCreate = jest.fn(() => ({ address, seed: hexSeed }));
const mockCreated = jest.fn(() => Promise.resolve());
jest.mock("@/stores/store", () => ({
  useStore: () => ({
    qrlStore: {
      qrlConnection: { blockchain: "TEST_NET" },
      qrlInstance: { accounts: { create: mockCreate } },
    },
  }),
}));
jest.mock("mobx-react-lite", () => ({ observer: (component: unknown) => component }));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/utils", () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(" ") }));
jest.mock("@/utils/crypto", () => ({
  encryptSeedAsync: jest.fn(),
  getMnemonicFromHexSeed: () => "synthetic mnemonic",
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: { getAllEncryptedSeeds: jest.fn(), storeEncryptedSeed: jest.fn() },
}));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => true, notifySeedStored: jest.fn() }));
jest.mock("@/utils/log", () => ({ logger: { error: jest.fn() } }));
jest.mock("@/components/UI/PinInput/PinInput", () => ({
  PinInput: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  }) => (
    <input
      aria-label={placeholder}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
  getSeeds.mockResolvedValue([]);
  jest.mocked(encryptSeedAsync).mockResolvedValue("encrypted fixture");
  storeSeed.mockResolvedValue({
    address,
    encryptedSeed: "encrypted fixture",
    lastAccessed: 1,
    revision: 2,
  });
  jest.mocked(notifySeedStored).mockResolvedValue({ revision: 2, ciphertextHash: "12".repeat(32) });
});
afterEach(cleanup);

async function submit() {
  render(<AccountCreationForm onAccountCreated={mockCreated} />);
  fireEvent.change(await screen.findByPlaceholderText("Password"), {
    target: { value: "Password1!" },
  });
  fireEvent.change(screen.getByPlaceholderText("Re-enter the password"), {
    target: { value: "Password1!" },
  });
  fireEvent.change(screen.getByLabelText("Enter PIN (4-6 digits)"), {
    target: { value: "123456" },
  });
  fireEvent.change(screen.getByLabelText("Re-enter PIN"), { target: { value: "123456" } });
  const button = screen.getByRole("button", { name: "Create account" });
  await waitFor(() => {
    expect(button.hasAttribute("disabled")).toBe(false);
  });
  fireEvent.click(button);
}

it("fails closed with a visible error when existing wallets cannot be loaded", async () => {
  const error = new Error("Storage unavailable");
  getSeeds.mockRejectedValueOnce(error);
  render(<AccountCreationForm onAccountCreated={mockCreated} />);
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toBe(
    "Could not load existing wallets. Please reload and try again.",
  );
  expect(screen.queryByPlaceholderText("Password")).toBeNull();
  expect(mockCreate).not.toHaveBeenCalled();
  expect(storeSeed).not.toHaveBeenCalled();
  expect(logError).toHaveBeenCalledWith("Failed to load existing wallets:", error);
});

it("preserves encryption, storage and native acknowledgement before activation", async () => {
  let acknowledge: ((value: { revision: number; ciphertextHash: string }) => void) | undefined;
  jest.mocked(notifySeedStored).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  await submit();
  await waitFor(() => {
    expect(notifySeedStored).toHaveBeenCalledTimes(1);
  });
  expect(encryptSeedAsync).toHaveBeenCalledWith("synthetic mnemonic", hexSeed, "123456");
  expect(storeSeed).toHaveBeenCalledWith(
    "TEST_NET",
    address,
    "encrypted fixture",
    expect.any(String),
  );
  expect(notifySeedStored).toHaveBeenCalledWith({
    address,
    encryptedSeed: "encrypted fixture",
    blockchain: "TEST_NET",
    revision: 2,
  });
  expect(mockCreated).not.toHaveBeenCalled();
  acknowledge?.({ revision: 2, ciphertextHash: "12".repeat(32) });
  await waitFor(() => {
    expect(mockCreated).toHaveBeenCalledWith({ address, seed: hexSeed }, "Password1!");
  });
});

it("preserves the error text and stored wallet when activation rejects", async () => {
  mockCreated.mockRejectedValueOnce(new Error("Activation failed"));
  await submit();
  await screen.findByText("Error: Activation failed There was an error while creating the account");
  expect(storeSeed).toHaveBeenCalledTimes(1);
  expect(notifySeedStored).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Encrypting..." })).toBeNull();
});
