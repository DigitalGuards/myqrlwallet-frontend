/** @jest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import axios from "axios";
import TransactionHistory from "../TransactionHistory";
import { TransactionHistoryPopup } from "../../AccountList/ActiveAccount/TransactionHistoryPopup";

const mockStore = {
  qrlStore: {
    activeAccount: { accountAddress: "Q" + "1".repeat(128) },
    qrlConnection: { blockchain: "TEST_NET" },
  },
};

jest.mock("axios");
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/config", () => ({
  SERVER_URL: "https://wallet.example/api",
  getExplorerAddressUrl: () => "https://explorer.example/address",
  getExplorerTxUrl: () => "https://explorer.example/tx",
}));
jest.mock("@/utils/formatting", () => ({
  formatBalance: (value: string) => value,
  formatAddressShort: (value: string) => value,
}));
jest.mock("@/components/UI/QrlAddress", () => ({ QrlAddress: () => null }));
jest.mock("@/utils/nativeApp", () => ({ openExternalUrl: jest.fn() }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

const post = jest.mocked(axios.post);
const row = (id: string) => ({
  ID: id,
  InOut: 1,
  TxType: "0x2",
  Address: "Q1",
  From: "Q2",
  To: "Q1",
  TxHash: id,
  TimeStamp: "0x1",
  Amount: "1",
  BlockNumber: "0x1",
});

beforeEach(() => {
  jest.resetAllMocks();
  mockStore.qrlStore.qrlConnection.blockchain = "TEST_NET";
  mockStore.qrlStore.activeAccount.accountAddress = "Q" + "1".repeat(128);
});
afterEach(cleanup);

it("sorts loaded amounts numerically and labels unverified historical fees unavailable", async () => {
  post.mockResolvedValueOnce({
    data: {
      transactions: [
        { ...row("larger"), Amount: "10" },
        { ...row("smaller"), Amount: "2" },
      ],
    },
  });
  render(<TransactionHistory />);
  await screen.findByRole("button", { name: "No more transactions" });
  fireEvent.click(
    screen.getByRole("columnheader", { name: "Amount (Quanta)" }),
  );
  expect(screen.getAllByRole("row")[1]?.textContent).toContain("smaller");
  const firstView = screen.getAllByRole("button", { name: "View" })[0];
  if (!firstView) throw new Error("Expected a transaction details control");
  fireEvent.click(firstView);
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(post).toHaveBeenCalledTimes(1);
});

it("resets network pagination and prevents an old network response replacing new history", async () => {
  let resolveOld!: (value: unknown) => void;
  post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  post.mockResolvedValueOnce({
    data: { transactions: [row("mainnet-history")] },
  });
  const view = render(<TransactionHistory />);
  expect(post.mock.calls[0]?.[1]).toMatchObject({
    network: "testnet",
    page: 1,
  });
  const oldOptions = post.mock.calls[0]?.[2];
  mockStore.qrlStore.qrlConnection.blockchain = "MAIN_NET";
  view.rerender(<TransactionHistory />);
  await waitFor(() =>
    expect(screen.getAllByText("mainnet-history").length).toBeGreaterThan(0),
  );
  expect(post.mock.calls[1]?.[1]).toMatchObject({
    network: "mainnet",
    page: 1,
  });
  expect(oldOptions?.signal?.aborted).toBe(true);
  await act(async () =>
    resolveOld({ data: { transactions: [row("obsolete-history")] } }),
  );
  expect(screen.queryByText("obsolete-history")).toBeNull();
});

it("resets exhausted pagination for a different account and retries the failed page", async () => {
  post.mockResolvedValueOnce({ data: { transactions: [] } });
  const view = render(<TransactionHistory />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "No more transactions" }),
    ).toHaveProperty("disabled", true),
  );
  post.mockResolvedValueOnce({
    data: {
      transactions: Array.from({ length: 5 }, (_, i) => row(`new-${i}`)),
    },
  });
  mockStore.qrlStore.activeAccount.accountAddress = "Q" + "2".repeat(128);
  view.rerender(<TransactionHistory />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Load More" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  post.mockRejectedValueOnce(new Error("temporary failure"));
  fireEvent.click(screen.getByRole("button", { name: "Load More" }));
  await screen.findByRole("button", { name: "Retry" });
  post.mockResolvedValueOnce({ data: { transactions: [row("retried-page")] } });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getAllByText("retried-page").length).toBeGreaterThan(0),
  );
  expect(post.mock.calls[2]?.[1]).toMatchObject({ page: 2 });
  expect(post.mock.calls[3]?.[1]).toMatchObject({ page: 2 });
});

it("shows unavailable history explicitly and does not relabel it as empty", async () => {
  jest.mocked(axios.isAxiosError).mockReturnValue(true);
  post.mockRejectedValueOnce({ response: { status: 501 } });
  render(
    <TransactionHistoryPopup
      accountAddress="Q1"
      blockchain="MAIN_NET"
      isOpen
      onClose={() => undefined}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Transaction history is unavailable for this network.",
  );
  expect(screen.queryByText("No transactions found")).toBeNull();
  expect(post.mock.calls[0]?.[1]).toMatchObject({ network: "mainnet" });
});

it("cancels popup history when the network changes or the popup closes", async () => {
  let resolveOld!: (value: unknown) => void;
  post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  post.mockResolvedValueOnce({ data: { transactions: [] } });
  const props = {
    accountAddress: "Q1",
    isOpen: true,
    onClose: () => undefined,
  };
  const view = render(
    <TransactionHistoryPopup {...props} blockchain="TEST_NET" />,
  );
  const oldOptions = post.mock.calls[0]?.[2];
  view.rerender(<TransactionHistoryPopup {...props} blockchain="MAIN_NET" />);
  await screen.findByText("No transactions found");
  expect(oldOptions?.signal?.aborted).toBe(true);
  await act(async () =>
    resolveOld({ data: { transactions: [row("old-popup")] } }),
  );
  expect(screen.queryByText("Received")).toBeNull();
  view.rerender(
    <TransactionHistoryPopup {...props} blockchain="MAIN_NET" isOpen={false} />,
  );
  expect(post.mock.calls[1]?.[2]?.signal?.aborted).toBe(true);
});
