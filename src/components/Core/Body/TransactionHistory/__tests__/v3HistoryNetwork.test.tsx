/** @jest-environment jsdom */

jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));
import { cleanup, render, screen } from "@testing-library/react";
import axios from "axios";
import type { AxiosRequestConfig } from "axios";
import { historyNetwork } from "@/config/runtimeProfile";
import TransactionHistory from "../TransactionHistory";
import { TransactionHistoryPopup } from "../../AccountList/ActiveAccount/TransactionHistoryPopup";

jest.mock("@/config/runtimeProfile", () => {
  Object.defineProperty(globalThis, "__QRL_WALLET_PROFILE__", {
    value: "v3-private",
    configurable: true,
  });
  return jest.requireActual<typeof import("@/config/runtimeProfile")>(
    "@/config/runtimeProfile",
  );
});
jest.mock("axios");
const mockStore = {
  qrlStore: {
    activeAccount: { accountAddress: `Q${"1".repeat(128)}` },
    qrlConnection: { blockchain: "TEST_NET_V3" },
  },
};
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/config", () => ({
  SERVER_URL: "https://v3-wallet.example/api",
  getExplorerAddressUrl: () => "https://v3-explorer.example/address",
  getExplorerTxUrl: () => "https://v3-explorer.example/tx",
}));
jest.mock("@/utils/formatting", () => ({
  formatBalance: (value: string) => value,
}));
jest.mock("@/components/UI/QrlAddress", () => ({
  QrlAddress: () => null,
  CompactAddressText: ({ address }: { address: string }) => address,
}));
jest.mock("@/utils/nativeApp", () => ({ openExternalUrl: jest.fn() }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

const post = jest.spyOn(axios, "post");

function expectV3HistoryRequest() {
  const signal: unknown = expect.any(AbortSignal);
  expect(post).toHaveBeenCalledWith(
    "https://v3-wallet.example/api/tx-history",
    expect.objectContaining({ network: "testnet", page: 1 }),
    expect.objectContaining({ signal }),
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(axios).post.mockResolvedValue({ data: { transactions: [] } });
});
afterEach(cleanup);

it("routes the v3 history page through the configured dev backend testnet route", async () => {
  render(<TransactionHistory />);
  await screen.findByRole("button", { name: "No more transactions" });
  expectV3HistoryRequest();
});

it("routes the v3 account popup through the same dev backend route", async () => {
  render(
    <TransactionHistoryPopup
      accountAddress={`Q${"1".repeat(128)}`}
      blockchain="TEST_NET_V3"
      isOpen
      onClose={() => undefined}
    />,
  );
  await screen.findByText("No transactions found");
  expectV3HistoryRequest();
});

describe("v3 request assertion correlation", () => {
  type HistoryCall = [
    url: string,
    body?: unknown,
    options?: AxiosRequestConfig<unknown>,
  ];
  const url = "https://v3-wallet.example/api/tx-history";
  const body = { network: "testnet", page: 1 };
  const signal = new AbortController().signal;
  const completeCall: HistoryCall = [url, body, { signal }];
  const incompleteCalls: { name: string; call: HistoryCall }[] = [
    {
      name: "another URL",
      call: ["https://other.example/api/tx-history", body, { signal }],
    },
    {
      name: "another network",
      call: [url, { ...body, network: "mainnet" }, { signal }],
    },
    { name: "another page", call: [url, { ...body, page: 2 }, { signal }] },
    { name: "missing network", call: [url, { page: 1 }, { signal }] },
    { name: "missing page", call: [url, { network: "testnet" }, { signal }] },
    { name: "missing body", call: [url, undefined, { signal }] },
    { name: "missing options", call: [url, body] },
    { name: "empty options", call: [url, body, {}] },
    { name: "undefined signal", call: [url, body, { signal: undefined }] },
    {
      name: "signal lookalike",
      call: [url, body, { signal: { aborted: false } }],
    },
  ];

  // Both rendered views use this assertion, so these fixtures protect both.
  it.each(incompleteCalls)(
    "rejects $name even when other calls supply the missing fields",
    ({ call }) => {
      post.mock.calls.push(call, [url, body, {}]);
      expect(expectV3HistoryRequest).toThrow();
      post.mock.calls.reverse();
      expect(expectV3HistoryRequest).toThrow();
    },
  );

  it.each(incompleteCalls)(
    "accepts a complete call after $name",
    ({ call }) => {
      post.mock.calls.push(call, completeCall);
      expect(expectV3HistoryRequest).not.toThrow();
    },
  );

  it("rejects fields split across three calls", () => {
    post.mock.calls.push(
      [url, { network: "testnet" }, { signal }],
      [url, { page: 1 }, { signal }],
      [url, body, {}],
    );
    expect(expectV3HistoryRequest).toThrow();
  });

  it("rejects an empty call history", () => {
    expect(expectV3HistoryRequest).toThrow();
  });

  it("accepts extra request fields and a signal aborted after capture", () => {
    const controller = new AbortController();
    post.mock.calls.push([
      url,
      { ...body, address: `Q${"1".repeat(128)}` },
      { signal: controller.signal, timeout: 1000 },
    ]);
    controller.abort();
    expect(expectV3HistoryRequest).not.toThrow();
  });
});

it.each(["TEST_NET", "MAIN_NET", "unknown"])(
  "does not route %s through the v3 backend",
  (network) => {
    expect(historyNetwork(network)).toBeNull();
  },
);
