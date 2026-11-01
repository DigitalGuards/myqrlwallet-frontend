/** @jest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type { TokenInterface } from "@/constants";
import { reportError } from "@/utils/reportError";
import CreateToken from "../CreateToken";
import TokenStatus from "../TokenStatus";

const mockNavigate = jest.fn<Promise<void> | void, [string]>();
const mockCreate = jest.fn<Promise<void>, unknown[]>();
const mockSetCreating = jest.fn<Promise<void>, [string, boolean]>();
const mockAdd = jest.fn<Promise<TokenInterface | null>, [TokenInterface]>();
const mockCopy = jest.fn<Promise<boolean>, [string]>();
let mockCreating: { name: string; creating: boolean; txHash?: string } = {
  name: "Test token",
  creating: false,
};
const mockStore = {
  qrlStore: {
    activeAccount: { accountAddress: `Q${"1".repeat(128)}` },
    activeAccountSource: "seed",
    qrlConnection: { blockchain: "TEST_NET" },
  },
  tokenStore: {
    createToken: mockCreate,
    setCreatingToken: mockSetCreating,
    addToken: mockAdd,
    get creatingToken() {
      return mockCreating;
    },
    createdToken: {
      name: "Test token",
      symbol: "TOK",
      decimals: 18,
      address: `Q${"2".repeat(128)}`,
      tx: `0x${"a".repeat(64)}`,
      blockHash: `0x${"b".repeat(64)}`,
      blockNumber: 7,
      gasUsed: 21000,
      effectiveGasPrice: 1000000000,
    },
  },
};

jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) =>
    values.filter((value) => typeof value === "string").join(" "),
  log: jest.fn(),
}));
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
jest.mock("@/router/router", () => ({
  ROUTES: {
    HOME: "/",
    IMPORT_ACCOUNT: "/import",
    CREATE_TOKEN: "/create-token",
    TOKEN_STATUS: "/token-status",
  },
}));
jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));
jest.mock("@/utils/storage", () => ({ StorageUtil: {} }));
jest.mock("@/utils/crypto", () => ({
  DeviceCredentialUnavailableError: class extends Error {},
  decryptStoredSeedWithPin: jest.fn(),
  getAddressFromMnemonicAsync: jest.fn(),
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: true }));
jest.mock("@/utils/web3", () => ({
  QRL_ZERO_ADDRESS: `Q${"0".repeat(128)}`,
  isValidQrlAddress: () => true,
}));
jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: (text: string) => mockCopy(text),
}));
jest.mock("@/utils/reportError", () => ({ reportError: jest.fn() }));
jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { explorer: "https://explorer.example" } },
}));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: MockResizeObserver,
  });
  jest.clearAllMocks();
  mockNavigate.mockReset();
  mockCreate.mockResolvedValue();
  mockSetCreating.mockResolvedValue();
  mockAdd.mockImplementation((token) => Promise.resolve(token));
  mockCopy.mockResolvedValue(true);
  mockCreating = { name: "Test token", creating: false };
});
afterEach(cleanup);

async function submitToken(decimals?: string) {
  render(<CreateToken />);
  if (decimals !== undefined) {
    fireEvent.change(screen.getByPlaceholderText("Example: 18"), {
      target: { value: decimals },
    });
  }
  fireEvent.change(screen.getByPlaceholderText("Example: MyQRLWallet"), {
    target: { value: "Test token" },
  });
  fireEvent.change(screen.getByPlaceholderText("Example: MQW"), {
    target: { value: "TOK" },
  });
  fireEvent.change(screen.getByPlaceholderText("Example: 1000000000"), {
    target: { value: "1" },
  });
  const submit = screen.getByRole("button", { name: "Create Token" });
  await waitFor(() => {
    expect(submit.getAttribute("disabled")).toBeNull();
  });
  fireEvent.click(submit);
}

it("sets creation status, starts navigation, and creates with unchanged defaults", async () => {
  const order: string[] = [];
  mockSetCreating.mockImplementation(() => {
    order.push("status");
    return Promise.resolve();
  });
  mockNavigate.mockImplementation(() => {
    order.push("navigate");
    return new Promise<void>(() => {});
  });
  mockCreate.mockImplementation(() => {
    order.push("create");
    return Promise.resolve();
  });
  await submitToken();
  await waitFor(() => {
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
  expect(order).toEqual(["status", "navigate", "create"]);
  expect(mockCreate).toHaveBeenCalledWith(
    "Test token",
    "TOK",
    "1000000000000000000",
    18,
    "1000000000000000000",
    `Q${"0".repeat(128)}`,
    "0",
    "0",
    "",
  );
});

it("reports background creation failure without submitting again", async () => {
  const error = new Error("Factory unavailable");
  mockCreate.mockRejectedValueOnce(error);
  await submitToken();
  await waitFor(() => {
    expect(reportError).toHaveBeenCalledWith("Token creation failed:", error);
  });
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

it("reports rejected status navigation while starting creation", async () => {
  const error = new Error("Navigation unavailable");
  mockNavigate.mockRejectedValueOnce(error);
  await submitToken();
  await waitFor(() => {
    expect(reportError).toHaveBeenCalledWith(
      "Failed to open token status:",
      error,
    );
  });
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

it("surfaces a failed creation-state update before starting creation", async () => {
  mockSetCreating.mockRejectedValueOnce(new Error("State unavailable"));
  await submitToken();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "An error occurred while creating the token",
  );
  expect(mockCreate).not.toHaveBeenCalled();
});

it("reports a failure adding the created token and retains the receipt", async () => {
  const error = new Error("Storage unavailable");
  mockAdd.mockRejectedValueOnce(error);
  render(<TokenStatus />);
  await waitFor(() => {
    expect(reportError).toHaveBeenCalledWith(
      "Failed to add token to list:",
      error,
    );
  });
  expect(mockAdd).toHaveBeenCalledWith({
    name: "Test token",
    symbol: "TOK",
    decimals: 18,
    address: mockStore.tokenStore.createdToken.address,
    amount: "0",
  });
  expect(screen.getByRole("heading").textContent).toBe("Token Created");
});

it("reports failed receipt copying", async () => {
  const error = new Error("Clipboard unavailable");
  mockCopy.mockRejectedValueOnce(error);
  const { container } = render(<TokenStatus />);
  const copy = container.querySelector("button");
  if (!copy) throw new Error("Missing receipt copy button");
  fireEvent.click(copy);
  await waitFor(() => {
    expect(reportError).toHaveBeenCalledWith(
      "Failed to copy transaction hash:",
      error,
    );
  });
  expect(mockCopy).toHaveBeenCalledWith(mockStore.tokenStore.createdToken.tx);
});

it("labels the token creation fee in Quanta as Network fee", () => {
  render(<TokenStatus />);
  expect(screen.getByText("Network fee").parentElement?.textContent).toBe(
    "Network fee0.000021 Quanta",
  );
  expect(screen.queryByText(/gas used/i)).toBeNull();
});


it("keeps decimals to whole numbers from 1 to 18", async () => {
  render(<CreateToken />);
  const decimals = screen.getByPlaceholderText("Example: 18");
  if (!(decimals instanceof HTMLInputElement)) throw new Error("Missing decimals input");
  expect(decimals.getAttribute("inputmode")).toBe("numeric");
  fireEvent.change(decimals, { target: { value: "7477474746464646" } });
  expect(decimals.value).toBe("74");
  expect(await screen.findByText("Use a whole number from 1 to 18")).toBeTruthy();
  fireEvent.change(decimals, { target: { value: "1.5e8" } });
  expect(decimals.value).toBe("15");
  await waitFor(() => {
    expect(screen.queryByText("Use a whole number from 1 to 18")).toBeNull();
  });
  fireEvent.change(decimals, { target: { value: "0" } });
  expect(decimals.value).toBe("0");
  expect(await screen.findByText("Use a whole number from 1 to 18")).toBeTruthy();
  fireEvent.change(decimals, { target: { value: "" } });
  expect(decimals.value).toBe("");
  expect(await screen.findByText("Decimals is required")).toBeTruthy();
});

it("creates with the decimals the user entered", async () => {
  await submitToken("8");
  await waitFor(() => {
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
  expect(mockCreate.mock.calls[0]?.slice(2, 5)).toEqual([
    "100000000",
    8,
    "100000000",
  ]);
});

it("links a pending creation to the explorer once its hash is known", () => {
  mockCreating = { name: "Test token", creating: true };
  const { unmount } = render(<TokenStatus />);
  expect(screen.queryByRole("link", { name: "View on Explorer" })).toBeNull();
  unmount();
  mockCreating = { name: "Test token", creating: true, txHash: `0x${"c".repeat(64)}` };
  render(<TokenStatus />);
  expect(
    screen.getByRole("link", { name: "View on Explorer" }).getAttribute("href"),
  ).toBe(`https://explorer.example/tx/0x${"c".repeat(64)}`);
});
