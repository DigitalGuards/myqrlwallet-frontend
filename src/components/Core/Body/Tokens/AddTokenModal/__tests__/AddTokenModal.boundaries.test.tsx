/** @jest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { TokenInterface } from "@/constants";
import { reportError } from "@/utils/reportError";
import { AddTokenModal } from "../AddTokenModal";

const ADDRESS = `Q${"1".repeat(128)}`;
const mockHolder = `Q${"2".repeat(128)}`;
const mockFetchInfo = jest.fn<Promise<unknown>, [string, string]>();
const mockFetchBalance = jest.fn<Promise<unknown>, [string, string, string]>();
const mockAddToken = jest.fn<
  Promise<TokenInterface | null>,
  [TokenInterface]
>();
const mockDiscover = jest.fn<Promise<TokenInterface[]>, [string]>();
const onClose = jest.fn();

jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) =>
    values.filter((value) => typeof value === "string").join(" "),
  log: jest.fn(),
}));
const mockStore = {
  qrlStore: { activeAccount: { accountAddress: mockHolder } },
  tokenStore: {
    pendingDiscoveredTokens: new Array<TokenInterface>(),
    addDiscoveredTokens: jest.fn<Promise<void>, [TokenInterface[]]>(),
    addToken: mockAddToken,
    discoverTokensForReview: mockDiscover,
  },
};
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("@/utils/web3", () => ({
  isValidQrlAddress: (value: string) => /^Q[0-9a-f]{128}$/i.test(value),
  fetchTokenInfo: (address: string, rpc: string) => mockFetchInfo(address, rpc),
  fetchBalance: (address: string, holder: string, rpc: string) =>
    mockFetchBalance(address, holder, rpc),
}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { url: "https://rpc.example" } },
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: { getBlockChain: () => Promise.resolve("TEST_NET") },
}));
jest.mock("@/utils/reportError", () => ({ reportError: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.tokenStore.pendingDiscoveredTokens = [];
  mockFetchInfo.mockResolvedValue({
    name: "Test token",
    symbol: "TOK",
    decimals: 6n,
  });
  mockFetchBalance.mockResolvedValue(1234567n);
  mockDiscover.mockResolvedValue([]);
  mockAddToken.mockImplementation((token) => Promise.resolve(token));
});
afterEach(cleanup);

function enterContract() {
  const view = render(<AddTokenModal isOpen onClose={onClose} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: ADDRESS } });
  return view;
}

it("adds the decoded metadata and formatted balance once, then closes", async () => {
  enterContract();
  await screen.findByDisplayValue("Test token");
  fireEvent.click(screen.getByRole("button", { name: "Add Token" }));
  await waitFor(() => {
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  expect(mockAddToken).toHaveBeenCalledWith({
    name: "Test token",
    symbol: "TOK",
    decimals: 6,
    address: ADDRESS,
    amount: "1.2345",
  });
  expect(mockFetchBalance).toHaveBeenCalledWith(
    ADDRESS,
    mockHolder,
    "https://rpc.example",
  );
  expect(mockAddToken).toHaveBeenCalledTimes(1);
});

it.each([undefined, null])(
  "keeps the legacy defaults for missing decimals and balance (%s)",
  async (missing) => {
    mockFetchInfo.mockResolvedValue({
      name: "Test token",
      symbol: "TOK",
      decimals: missing,
    });
    mockFetchBalance.mockResolvedValue(missing);
    enterContract();
    await screen.findByDisplayValue("Test token");
    fireEvent.click(screen.getByRole("button", { name: "Add Token" }));
    await waitFor(() => {
      expect(mockAddToken).toHaveBeenCalledTimes(1);
    });
    expect(mockAddToken).toHaveBeenCalledWith({
      name: "Test token",
      symbol: "TOK",
      decimals: 18,
      address: ADDRESS,
      amount: "0.0",
    });
  },
);

it.each([
  null,
  { name: {}, symbol: "TOK", decimals: 6 },
  { name: "Test token", symbol: [], decimals: 6 },
  { name: "Test token", symbol: "TOK", decimals: "6garbage" },
  { name: "Test token", symbol: "TOK", decimals: -1 },
  { name: "Test token", symbol: "TOK", decimals: 256 },
])("rejects malformed metadata without adding a record: %j", async (info) => {
  mockFetchInfo.mockResolvedValue(info);
  enterContract();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Could not fetch token info",
  );
  expect(mockAddToken).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it.each([{}, "garbage", -1n])(
  "rejects malformed balances without adding a record: %s",
  async (balance) => {
    mockFetchBalance.mockResolvedValue(balance);
    enterContract();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Invalid token balance.",
    );
    expect(mockAddToken).not.toHaveBeenCalled();
  },
);

it("shows a failed persistence error and retains the entered token for retry", async () => {
  mockAddToken.mockRejectedValueOnce(new Error("Storage unavailable"));
  enterContract();
  await screen.findByDisplayValue("Test token");
  fireEvent.click(screen.getByRole("button", { name: "Add Token" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Add failed: Storage unavailable",
  );
  expect(screen.getByDisplayValue(ADDRESS)).toBeTruthy();
  expect(screen.getByDisplayValue("Test token")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add Token" }));
  await waitFor(() => {
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

it("reports a rejected discovery request", async () => {
  const error = new Error("Explorer unavailable");
  mockDiscover.mockRejectedValueOnce(error);
  render(<AddTokenModal isOpen onClose={onClose} />);
  await waitFor(() => {
    expect(reportError).toHaveBeenCalledWith(
      "Failed to discover tokens:",
      error,
    );
  });
});

it.each([
  [
    new Error("RPC refused <request>"),
    "Could not fetch token info. The address may not be a QRC-20 token contract. (RPC refused <request>)",
  ],
  [
    "offline",
    "Could not fetch token info. The address may not be a token contract.",
  ],
])(
  "preserves origin/dev token lookup failure details (%s)",
  async (reason, expected) => {
    mockFetchInfo.mockRejectedValueOnce(reason);
    enterContract();
    expect((await screen.findByRole("alert")).textContent).toBe(expected);
  },
);

it("preserves origin/dev non-Error add failure", async () => {
  mockAddToken.mockRejectedValueOnce("offline");
  enterContract();
  await screen.findByDisplayValue("Test token");
  fireEvent.click(screen.getByRole("button", { name: "Add Token" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Add failed.");
});

it.each([
  [
    new Error("Storage unavailable"),
    "Failed to add picks: Storage unavailable",
  ],
  ["offline", "Failed to add picks."],
])(
  "preserves origin/dev discovered-token failure details (%s)",
  async (reason, expected) => {
    mockStore.tokenStore.pendingDiscoveredTokens = [
      {
        address: ADDRESS,
        name: "Pick",
        symbol: "PICK",
        decimals: 6,
        amount: "1",
      },
    ];
    mockStore.tokenStore.addDiscoveredTokens.mockRejectedValueOnce(reason);
    render(<AddTokenModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Add Selected (1)" }));
    expect((await screen.findByRole("alert")).textContent).toBe(expected);
  },
);
