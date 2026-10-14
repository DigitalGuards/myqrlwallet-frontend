/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import AddressBook from "../AddressBook";
import { AddressBookPicker } from "../AddressBookPicker";
import { copyToClipboard } from "@/utils/nativeApp";
import { logger } from "@/utils/log";

const mockNavigate = jest.fn(() => Promise.resolve());
const logError = jest.spyOn(logger, "error");
const mockAddress = `Q${"12".repeat(64)}`;
jest.mock("react-router", () => ({ useNavigate: () => mockNavigate }));
jest.mock("@/router/router", () => ({
  ROUTES: { TRANSFER: "/transfer", ADDRESS_BOOK: "/address-book" },
}));
jest.mock("@/components/Core/Layout/PageShell", () => ({
  PageShell: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("@/utils/addressBook", () => ({
  isValidQrlAddress: () => false,
  loadAddressBook: () => [{ id: "fixture", name: "Recipient", address: mockAddress }],
}));
jest.mock("@/utils/nativeApp", () => ({ copyToClipboard: jest.fn(() => Promise.resolve(true)) }));
jest.mock("@/utils/log", () => ({ logger: { error: jest.fn() } }));
jest.mock("@/utils", () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(" ") }));
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it("passes the saved address to transfer navigation and reports rejection", async () => {
  const error = new Error("Navigation failed");
  mockNavigate.mockRejectedValueOnce(error);
  render(<AddressBook />);
  fireEvent.click(screen.getByTitle("Send to this address"));
  expect(mockNavigate).toHaveBeenCalledWith("/transfer", {
    state: { receiverAddress: mockAddress },
  });
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to open transfer:", error);
  });
});

it("reports clipboard rejection for the saved address", async () => {
  const error = new Error("Clipboard unavailable");
  jest.mocked(copyToClipboard).mockRejectedValueOnce(error);
  render(<AddressBook />);
  fireEvent.click(screen.getByTitle("Copy address"));
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to copy address:", error);
  });
  expect(copyToClipboard).toHaveBeenCalledWith(mockAddress);
});

it("closes the picker before opening management and contains navigation failure", async () => {
  const error = new Error("Navigation failed");
  const close = jest.fn();
  mockNavigate.mockImplementationOnce(() => {
    expect(close).toHaveBeenCalledWith(false);
    return Promise.reject(error);
  });
  render(<AddressBookPicker open onOpenChange={close} onSelect={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Manage address book" }));
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to open address book:", error);
  });
  expect(mockNavigate).toHaveBeenCalledWith("/address-book");
});
