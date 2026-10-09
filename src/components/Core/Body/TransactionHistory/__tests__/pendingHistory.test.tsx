/** @jest-environment jsdom */

jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));
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
import { transactionHistoryStore } from "@/stores/transactionHistoryStore";

const from = `Q${"a".repeat(128)}`;
const to = `Q${"b".repeat(128)}`;
const hash = `0x${"c".repeat(64)}`;
const details = { blockchain: "TEST_NET", from, to, hash, amount: "1.25" };
const mockRpc = jest.fn<Promise<unknown>, [unknown]>();
const mockStore = {
  qrlStore: {
    activeAccount: { accountAddress: from },
    qrlConnection: { blockchain: "TEST_NET" },
    qrlInstance: { requestManager: { send: mockRpc } },
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
}));
jest.mock("@/components/UI/QrlAddress", () => ({
  QrlAddress: ({ address }: { address: string }) => address,
  CompactAddressText: ({ address }: { address: string }) => address,
}));
jest.mock("@/utils/nativeApp", () => ({ openExternalUrl: jest.fn() }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

beforeEach(() => {
  jest.resetAllMocks();
  localStorage.clear();
  transactionHistoryStore.reload();
  mockStore.qrlStore.activeAccount.accountAddress = from;
  mockStore.qrlStore.qrlConnection.blockchain = "TEST_NET";
  jest.mocked(axios.post).mockResolvedValue({ data: { transactions: [] } });
  mockRpc.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("shows amount, recipient, hash and plain pending status while backend history is loading", () => {
  jest.mocked(axios.post).mockReturnValue(new Promise(() => undefined));
  transactionHistoryStore.record(details);
  render(<TransactionHistory />);
  expect(screen.getByText("Pending")).toBeTruthy();
  expect(screen.getByText("1.25")).toBeTruthy();
  expect(screen.getByText(to)).toBeTruthy();
  expect(screen.getByText(hash)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View" }));
  expect(screen.getByText("Transaction Details")).toBeTruthy();
  expect(screen.getAllByText("Pending")).toHaveLength(2);
});

it("immediately renders a new broadcast while history is already open and survives reopening", async () => {
  const view = render(<TransactionHistory />);
  await screen.findByRole("button", { name: "No more transactions" });
  act(() => {
    transactionHistoryStore.record(details);
  });
  expect(screen.getByText("Pending")).toBeTruthy();
  view.unmount();
  transactionHistoryStore.reload();
  render(<TransactionHistory />);
  expect(screen.getByText("Pending")).toBeTruthy();
  await screen.findByRole("button", { name: "No more transactions" });
});

it.each([
  ["0x1", "Confirmed"],
  ["0x0", "Failed"],
])(
  "reconciles a reloaded broadcast into %s and deduplicates backend catch-up",
  async (status, label) => {
    transactionHistoryStore.record(details);
    mockRpc.mockResolvedValue({
      transactionHash: hash,
      blockNumber: "0x42",
      status,
    });
    const view = render(<TransactionHistory />);
    await screen.findByText(label);
    expect(screen.queryByText("Pending")).toBeNull();
    view.unmount();
    jest.mocked(axios.post).mockResolvedValue({
      data: {
        transactions: [
          {
            ID: "backend-id",
            InOut: 0,
            TxType: "0x2",
            Address: from,
            From: from,
            To: to,
            TxHash: hash,
            TimeStamp: "0x42",
            Amount: "1.25",
            BlockNumber: "0x42",
            Status: status,
          },
        ],
      },
    });
    render(<TransactionHistory />);
    await screen.findByRole("button", { name: "No more transactions" });
    expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(1);
    expect(screen.getByText(label)).toBeTruthy();
  },
);

it("keeps recent local transactions visible when the backend is unavailable", async () => {
  transactionHistoryStore.record(details);
  jest.mocked(axios.post).mockRejectedValue(new Error("offline"));
  render(
    <TransactionHistoryPopup
      accountAddress={from}
      blockchain="TEST_NET"
      isOpen
      onClose={() => undefined}
    />,
  );
  await screen.findByRole("alert");
  expect(screen.getByText("Pending")).toBeTruthy();
  expect(screen.getByText(hash)).toBeTruthy();
  expect(screen.getByText(`To ${to}`)).toBeTruthy();
  expect(screen.queryByText("No transactions found")).toBeNull();
});

it("fails closed on malformed history and retains the local send", async () => {
  transactionHistoryStore.record(details);
  jest
    .mocked(axios.post)
    .mockResolvedValue({ data: { transactions: [{ Amount: {} }] } });
  render(<TransactionHistory />);
  await screen.findByRole("alert");
  expect(screen.getByText("Pending")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(1);
});

it("isolates account and network switches and ignores an old in-flight receipt", async () => {
  transactionHistoryStore.record(details);
  let resolve: (value: unknown) => void = () => undefined;
  mockRpc.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(<TransactionHistory />);
  await screen.findByRole("button", { name: "No more transactions" });
  mockStore.qrlStore.activeAccount.accountAddress = to;
  view.rerender(<TransactionHistory />);
  expect(screen.queryByText("Pending")).toBeNull();
  mockStore.qrlStore.activeAccount.accountAddress = from;
  mockStore.qrlStore.qrlConnection.blockchain = "MAIN_NET";
  view.rerender(<TransactionHistory />);
  await act(async () => {
    resolve({ transactionHash: hash, blockNumber: "0x42", status: "0x1" });
  });
  expect(screen.queryByText("Pending")).toBeNull();
  expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
    "pending",
  );
});

it("continues pending receipt checks and stops when the view unmounts", async () => {
  jest.useFakeTimers();
  transactionHistoryStore.record(details);
  const view = render(<TransactionHistory />);
  await act(async () => {
    await Promise.resolve();
  });
  const initial = mockRpc.mock.calls.length;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10000);
  });
  expect(mockRpc.mock.calls.length).toBeGreaterThan(initial);
  view.unmount();
  const stopped = mockRpc.mock.calls.length;
  await jest.advanceTimersByTimeAsync(20000);
  expect(mockRpc).toHaveBeenCalledTimes(stopped);
});

it.each(["page", "popup"])(
  "shares one poller across views when %s unmounts first",
  async (first) => {
    jest.useFakeTimers();
    transactionHistoryStore.record(details);
    const page = render(<TransactionHistory />);
    const popup = render(
      <TransactionHistoryPopup
        accountAddress={from}
        blockchain="TEST_NET"
        isOpen
        onClose={() => undefined}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockRpc).toHaveBeenCalledTimes(2);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
    });
    expect(mockRpc).toHaveBeenCalledTimes(4);
    (first === "page" ? page : popup).unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
    });
    expect(mockRpc).toHaveBeenCalledTimes(6);
    (first === "page" ? popup : page).unmount();
    await jest.advanceTimersByTimeAsync(20000);
    expect(mockRpc).toHaveBeenCalledTimes(6);
  },
);

it("keeps one request in flight across views and discards it after both close", async () => {
  jest.useFakeTimers();
  transactionHistoryStore.record(details);
  let resolve: (value: unknown) => void = () => undefined;
  mockRpc.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const page = render(<TransactionHistory />);
  const popup = render(
    <TransactionHistoryPopup
      accountAddress={from}
      blockchain="TEST_NET"
      isOpen
      onClose={() => undefined}
    />,
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(30000);
  });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  page.unmount();
  popup.unmount();
  await act(async () => {
    resolve({ transactionHash: hash, blockNumber: "0x42", status: "0x1" });
  });
  expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
    "pending",
  );
});

it("keeps local entries searchable and displays persistence failures", async () => {
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  act(() => {
    transactionHistoryStore.record(details);
  });
  render(<TransactionHistory />);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be saved",
    ),
  );
  fireEvent.change(
    screen.getByPlaceholderText("Search loaded transactions..."),
    { target: { value: to } },
  );
  expect(screen.getByText("Pending")).toBeTruthy();
});
