/** @jest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import axios from "axios";
import { historyNetwork } from "@/config/runtimeProfile";
import TransactionHistory from "../TransactionHistory";
import { TransactionHistoryPopup } from "../../AccountList/ActiveAccount/TransactionHistoryPopup";

jest.mock("@/config/runtimeProfile", () => {
  Object.defineProperty(globalThis, "__QRL_WALLET_PROFILE__", {
    value: "v3-private",
    configurable: true,
  });
  return jest.requireActual("@/config/runtimeProfile");
});
jest.mock("axios");
jest.mock("@/stores/store", () => ({
  useStore: () => ({
    qrlStore: {
      activeAccount: { accountAddress: `Q${"1".repeat(128)}` },
      qrlConnection: { blockchain: "TEST_NET_V3" },
    },
  }),
}));
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
  formatAddressShort: (value: string) => value,
}));
jest.mock("@/components/UI/QrlAddress", () => ({ QrlAddress: () => null }));
jest.mock("@/utils/nativeApp", () => ({ openExternalUrl: jest.fn() }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(axios.post).mockResolvedValue({ data: { transactions: [] } });
});
afterEach(cleanup);

it("routes the v3 history page through the configured dev backend testnet route", async () => {
  render(<TransactionHistory />);
  await screen.findByRole("button", { name: "No more transactions" });
  expect(axios.post).toHaveBeenCalledWith(
    "https://v3-wallet.example/api/tx-history",
    expect.objectContaining({ network: "testnet", page: 1 }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
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
  expect(axios.post).toHaveBeenCalledWith(
    "https://v3-wallet.example/api/tx-history",
    expect.objectContaining({ network: "testnet", page: 1 }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

it.each(["TEST_NET", "MAIN_NET", "unknown"])(
  "does not route %s through the v3 backend",
  (network) => {
    expect(historyNetwork(network)).toBeNull();
  },
);
