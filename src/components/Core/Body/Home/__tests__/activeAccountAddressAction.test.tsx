/** @jest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { copyToClipboard } from "@/utils/nativeApp";
import { ActiveAccountDisplay } from "../AccountCreateImport/ActiveAccountDisplay/ActiveAccountDisplay";
import { logger } from "@/utils/log";

const logError = jest.spyOn(logger, "error");

const mockFetchAccounts = jest.fn(() => Promise.resolve());
const mockFetchPrice = jest.fn(() => Promise.resolve());
let mockBlockchain = "TEST_NET";
let mockPrice = 0;

const ADDRESS =
  "Qd5812F6Cf4a0f645aa620cd57319a0Ed649dd8f5519A9dde7770ae5b0E49e547985f35eB972A2a07041561aa39c65A3991478f9B1e6749e05277dcf58A9A8B72";

jest.mock("@/stores/store", () => ({
  useStore: () => ({
    qrlStore: {
      activeAccount: { accountAddress: ADDRESS },
      qrlConnection: { blockchain: mockBlockchain },
      activeAccountBalance: "123",
      activeAccountBalanceUsd: 123 * mockPrice,
      qrlPrice: mockPrice,
      qrlPriceChange24h: 2.5,
      fetchAccounts: mockFetchAccounts,
      fetchQrlPrice: mockFetchPrice,
    },
  }),
}));
jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(() => Promise.resolve(true)),
}));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/utils/log", () => ({ logger: { error: jest.fn() } }));
jest.mock("../AccountCreateImport/ActiveAccountDisplay/SlotBalance", () => ({
  SlotBalance: ({ value }: { value: string }) => <span>{value}</span>,
}));

beforeEach(() => {
  mockBlockchain = "TEST_NET";
  mockPrice = 0;
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it("reports clipboard rejection without showing copied feedback", async () => {
  const error = new Error("Clipboard unavailable");
  jest.mocked(copyToClipboard).mockRejectedValueOnce(error);
  const view = render(<ActiveAccountDisplay onShowAddress={jest.fn()} />);
  fireEvent.click(view.getByLabelText("QRL address " + ADDRESS));
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to copy address:", error);
  });
  expect(view.container.querySelector(".lucide-check")).toBeNull();
});

it("waits for balances before starting a price refresh and contains price rejection", async () => {
  let finish: (() => void) | undefined;
  mockFetchAccounts.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const error = new Error("Price unavailable");
  mockFetchPrice.mockRejectedValueOnce(error);
  const view = render(<ActiveAccountDisplay onShowAddress={jest.fn()} />);
  const refresh = view.container.querySelector("button:has(.lucide-refresh-cw)");
  if (!refresh) throw new Error("Refresh button is missing");
  fireEvent.click(refresh);
  expect(mockFetchAccounts).toHaveBeenCalledTimes(1);
  expect(mockFetchPrice).not.toHaveBeenCalled();
  expect(refresh.hasAttribute("disabled")).toBe(true);
  finish?.();
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to refresh QRL price:", error);
  });
  expect(mockFetchPrice).toHaveBeenCalledTimes(1);
});

it("reports a rejected balance refresh and skips the price request", async () => {
  const error = new Error("Balances unavailable");
  mockFetchAccounts.mockRejectedValueOnce(error);
  const view = render(<ActiveAccountDisplay onShowAddress={jest.fn()} />);
  const refresh = view.container.querySelector("button:has(.lucide-refresh-cw)");
  if (!refresh) throw new Error("Refresh button is missing");
  fireEvent.click(refresh);
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to refresh account balances:", error);
  });
  expect(mockFetchPrice).not.toHaveBeenCalled();
});

it("opens Receive through Show full without expanding or copying the wallet address", () => {
  const onShowAddress = jest.fn();
  const view = render(<ActiveAccountDisplay onShowAddress={onShowAddress} />);

  fireEvent.click(view.getByRole("button", { name: "Show full" }));

  expect(onShowAddress).toHaveBeenCalledTimes(1);
  expect(copyToClipboard).not.toHaveBeenCalled();
  expect(view.getByText("Qd5812F6C...e547985f...8A9A8B72")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Show less" })).toBeNull();
  expect(view.container.querySelector('[data-address-mode="full"]')).toBeNull();
});

it("keeps direct address copying separate from Receive", async () => {
  const onShowAddress = jest.fn();
  const view = render(<ActiveAccountDisplay onShowAddress={onShowAddress} />);

  fireEvent.click(view.getByLabelText("QRL address " + ADDRESS));

  await waitFor(() => {
    expect(copyToClipboard).toHaveBeenCalledWith(ADDRESS);
  });
  expect(onShowAddress).not.toHaveBeenCalled();
});

it.each(["TEST_NET", "TEST_NET_V3", "MAIN_NET"])(
  "shows the USD estimate and price change only on mainnet (%s)",
  (blockchain) => {
    mockBlockchain = blockchain;
    mockPrice = 2;
    const view = render(<ActiveAccountDisplay onShowAddress={jest.fn()} />);
    expect(view.getByText("123.00")).toBeTruthy();
    expect(view.getByText("Quanta")).toBeTruthy();
    expect(view.queryByText("≈ $246.00") !== null).toBe(blockchain === "MAIN_NET");
    expect(view.queryByText("▲ +2.50%") !== null).toBe(blockchain === "MAIN_NET");
    expect(mockFetchPrice).not.toHaveBeenCalled();
  },
);

it("keeps the mainnet USD line hidden until a price is available", () => {
  mockBlockchain = "MAIN_NET";
  const view = render(<ActiveAccountDisplay onShowAddress={jest.fn()} />);
  expect(view.queryByText(/≈ \$/)).toBeNull();
  expect(view.queryByText("▲ +2.50%")).toBeNull();
});

it("updates the USD line when the active network changes", () => {
  mockBlockchain = "MAIN_NET";
  mockPrice = 2;
  const view = render(<ActiveAccountDisplay onShowAddress={jest.fn()} />);
  expect(view.getByText("≈ $246.00")).toBeTruthy();
  for (const blockchain of ["TEST_NET", "TEST_NET_V3"]) {
    mockBlockchain = blockchain;
    view.rerender(<ActiveAccountDisplay onShowAddress={jest.fn()} />);
    expect(view.queryByText("≈ $246.00")).toBeNull();
  }
  mockBlockchain = "MAIN_NET";
  view.rerender(<ActiveAccountDisplay onShowAddress={jest.fn()} />);
  expect(view.getByText("≈ $246.00")).toBeTruthy();
});
