/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OtherAccounts } from "../OtherAccounts/OtherAccounts";
import ConnectionFailed from "../../Home/ConnectionFailed/ConnectionFailed";
import { logger } from "@/utils/log";

const mockSelect = jest.fn(() => Promise.resolve());
const mockConnect = jest.fn(() => Promise.resolve());
const logError = jest.spyOn(logger, "error");
const mockAddress = `Q${"12".repeat(64)}`;
const mockStore = {
  qrlAccounts: { accounts: [{ accountAddress: mockAddress, source: "seed" }] },
  activeAccount: { accountAddress: "" },
  qrlConnection: { blockchain: "TEST_NET" },
  setActiveAccount: mockSelect,
  fetchQrlConnection: mockConnect,
};
jest.mock("@/config", () => ({ getExplorerAddressUrl: () => "https://explorer.example/address" }));
jest.mock("@/utils/nativeApp", () => ({ openExternalUrl: jest.fn() }));
jest.mock("@/stores/store", () => ({ useStore: () => ({ qrlStore: mockStore }) }));
jest.mock("mobx-react-lite", () => ({ observer: (component: unknown) => component }));
jest.mock("@/utils", () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(" ") }));
jest.mock("../AccountId/AccountId", () => ({ AccountId: () => null }));
jest.mock("../AccountBalance/AccountBalance", () => ({ AccountBalance: () => null }));
jest.mock("../CopyAddressButton/CopyAddressButton", () => ({ CopyAddressButton: () => null }));
jest.mock("@/utils/log", () => ({ logger: { error: jest.fn() } }));
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it("preserves account address, source and receiver while handling activation rejection", async () => {
  const error = new Error("Selection failed");
  mockSelect.mockRejectedValueOnce(error);
  const view = render(<OtherAccounts />);
  const button = view.container.querySelector("button:has(.lucide-arrow-right)");
  if (!button) throw new Error("Account selection button is missing");
  fireEvent.click(button);
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to switch account:", error);
  });
  expect(mockSelect).toHaveBeenCalledWith(mockAddress, "seed");
  expect(mockSelect.mock.contexts[0]).toBe(mockStore);
});

it("retries through the store and reports connection rejection", async () => {
  const error = new Error("Connection failed");
  mockConnect.mockRejectedValueOnce(error);
  render(<ConnectionFailed />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to retry blockchain connection:", error);
  });
  expect(mockConnect).toHaveBeenCalledTimes(1);
  expect(mockConnect.mock.contexts[0]).toBe(mockStore);
});
