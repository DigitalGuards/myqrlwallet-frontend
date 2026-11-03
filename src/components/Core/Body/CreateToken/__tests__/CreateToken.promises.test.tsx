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

const mockNavigate = jest.fn<
  Promise<void> | void,
  [string, { replace: true }?]
>();
const mockCreate = jest.fn<Promise<void>, unknown[]>();
const mockSetCreating = jest.fn<Promise<void>, [string, boolean]>();
const mockAdd = jest.fn<Promise<TokenInterface | null>, [TokenInterface]>();
const mockCopy = jest.fn<Promise<boolean>, [string]>();
let mockCreating: {
  name: string;
  creating: boolean;
  error?: string;
  txHash?: string;
  txUrl?: string;
} = {
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

// The page Back has its own tests. This stand-in shows where it is and
// whether it is held, without a router.
jest.mock("@/components/Core/Layout/PageBack", () => ({
  PageBack: () => null,
  RouteBack: ({ route, disabled }: { route: string; disabled?: boolean }) => (
    <span
      data-testid="route-back"
      data-route={route}
      data-held={String(disabled === true)}
    />
  ),
}));
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
  isValidQrlAddress: (value: string) => /^Q[0-9a-f]{128}$/i.test(value),
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


it("keeps decimals to whole numbers from 1 to 18 and never rewrites the input", async () => {
  render(<CreateToken />);
  const decimals = screen.getByPlaceholderText("Example: 18");
  if (!(decimals instanceof HTMLInputElement)) throw new Error("Missing decimals input");
  expect(decimals.getAttribute("inputmode")).toBe("numeric");
  expect(decimals.getAttribute("maxlength")).toBeNull();
  for (const value of ["7477474746464646", "1.5", "1e8", "0", "19", "abc"]) {
    // Start each case from a valid value so a stale message cannot pass it.
    fireEvent.change(decimals, { target: { value: "8" } });
    await waitFor(() => {
      expect(screen.queryByText("Use a whole number from 1 to 18")).toBeNull();
    });
    fireEvent.change(decimals, { target: { value } });
    expect(decimals.value).toBe(value);
    expect(await screen.findByText("Use a whole number from 1 to 18")).toBeTruthy();
  }
  fireEvent.change(decimals, { target: { value: " 18" } });
  await waitFor(() => {
    expect(screen.queryByText("Use a whole number from 1 to 18")).toBeNull();
  });
  fireEvent.change(decimals, { target: { value: "" } });
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

it("links a creation to the explorer once its hash is known, also after a failure", () => {
  const txHash = `0x${"c".repeat(64)}`;
  const txUrl = `https://explorer.example/tx/${txHash}`;
  mockCreating = { name: "Test token", creating: true };
  const { unmount } = render(<TokenStatus />);
  expect(screen.queryByRole("link", { name: "View on Explorer" })).toBeNull();
  unmount();
  mockCreating = { name: "Test token", creating: true, txHash, txUrl };
  const pending = render(<TokenStatus />);
  expect(
    screen.getByRole("link", { name: "View on Explorer" }).getAttribute("href"),
  ).toBe(txUrl);
  pending.unmount();
  mockCreating = {
    name: "",
    creating: false,
    error: "Token creation confirmation timed out.",
    txHash,
    txUrl,
  };
  render(<TokenStatus />);
  expect(screen.getByRole("heading").textContent).toBe("Token Creation Failed");
  expect(
    screen.getByRole("link", { name: "View on Explorer" }).getAttribute("href"),
  ).toBe(txUrl);
});

it.each([
  ["Example: MyQRLWallet", "x".repeat(51), "Use up to 50 characters, without hidden or control characters"],
  ["Example: MyQRLWallet", "Bad\u202Ename", "Use up to 50 characters, without hidden or control characters"],
  ["Example: MQW", "MQ-W", "Use up to 11 letters or digits (A to Z, 0 to 9)"],
  ["Example: MQW", "ABCDEFGHIJKL", "Use up to 11 letters or digits (A to Z, 0 to 9)"],
  ["Example: 1000000000", "1,000", "Enter a plain number, such as 1000 or 0.5"],
  ["Example: 1000000000", "1e5", "Enter a plain number, such as 1000 or 0.5"],
  ["Example: 1000000000", "-5", "Enter a plain number, such as 1000 or 0.5"],
  ["Example: 1000000000", "0.1234567890123456789", "Too many decimal places for the token's decimals"],
  ["Example: 1000000000", "9".repeat(80), "This number is too large for a token"],
  ["Example: 1000000000", "0", "Enter an amount above 0"],
])("rejects %s input %p as typed", async (placeholder, value, message) => {
  render(<CreateToken />);
  const input = screen.getByPlaceholderText(placeholder);
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing input");
  fireEvent.change(input, { target: { value } });
  expect(input.value).toBe(value);
  expect(await screen.findByText(message)).toBeTruthy();
});

it("requires a mintable max supply of at least the initial supply", async () => {
  render(<CreateToken />);
  fireEvent.change(screen.getByPlaceholderText("Example: 1000000000"), {
    target: { value: "100" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Mintable" }));
  const max = await screen.findByPlaceholderText("Example: 999999999");
  fireEvent.change(max, { target: { value: "50" } });
  expect(
    await screen.findByText("Max supply must be at least the initial supply"),
  ).toBeTruthy();
  fireEvent.change(max, { target: { value: "" } });
  expect(await screen.findByText("Enter an amount above 0")).toBeTruthy();
  fireEvent.change(max, { target: { value: "100" } });
  await waitFor(() => {
    expect(screen.queryByText("Enter an amount above 0")).toBeNull();
  });
  expect(
    screen.queryByText("Max supply must be at least the initial supply"),
  ).toBeNull();
});

it("rejects a missing or zero recipient once the recipient is changed", async () => {
  render(<CreateToken />);
  const message =
    "Invalid recipient address. Use Q followed by 128 hex characters with a valid checksum";
  fireEvent.click(screen.getByRole("checkbox", { name: "Change Initial recipient" }));
  const recipient = await screen.findByPlaceholderText("Q followed by 128 hex characters");
  fireEvent.change(recipient, { target: { value: "Q123" } });
  expect(await screen.findByText(message)).toBeTruthy();
  fireEvent.change(recipient, { target: { value: `Q${"1".repeat(128)}` } });
  await waitFor(() => {
    expect(screen.queryByText(message)).toBeNull();
  });
  fireEvent.change(recipient, { target: { value: "" } });
  expect(await screen.findByText(message)).toBeTruthy();
  fireEvent.change(recipient, { target: { value: `Q${"1".repeat(128)}` } });
  await waitFor(() => {
    expect(screen.queryByText(message)).toBeNull();
  });
  fireEvent.change(recipient, { target: { value: `Q${"0".repeat(128)}` } });
  expect(await screen.findByText(message)).toBeTruthy();
});

it("does not deploy a cap or max supply that was typed and then switched off", async () => {
  render(<CreateToken />);
  fireEvent.change(screen.getByPlaceholderText("Example: MyQRLWallet"), {
    target: { value: "Test token" },
  });
  fireEvent.change(screen.getByPlaceholderText("Example: MQW"), {
    target: { value: "TOK" },
  });
  fireEvent.change(screen.getByPlaceholderText("Example: 1000000000"), {
    target: { value: "1" },
  });
  for (const name of ["Mintable", "Max Wallet Amount", "Max Transaction Limit"]) {
    fireEvent.click(screen.getByRole("checkbox", { name }));
  }
  for (const input of await screen.findAllByPlaceholderText("Example: 999999999")) {
    fireEvent.change(input, { target: { value: "5" } });
  }
  for (const name of ["Mintable", "Max Wallet Amount", "Max Transaction Limit"]) {
    fireEvent.click(screen.getByRole("checkbox", { name }));
  }
  const submit = screen.getByRole("button", { name: "Create Token" });
  await waitFor(() => {
    expect(submit.getAttribute("disabled")).toBeNull();
  });
  fireEvent.click(submit);
  await waitFor(() => {
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
  expect(mockCreate.mock.calls[0]?.slice(2, 8)).toEqual([
    "1000000000000000000",
    18,
    "1000000000000000000",
    `Q${"0".repeat(128)}`,
    "0",
    "0",
  ]);
});

const backHeld = () => screen.getByTestId("route-back").dataset["held"];

it("holds Back while the form submits, then replaces the form with the status page", async () => {
  let markCreating: () => void = () => {
    throw new Error("Submission did not start");
  };
  mockSetCreating.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        markCreating = resolve;
      }),
  );
  await submitToken();
  await waitFor(() => {
    expect(mockSetCreating).toHaveBeenCalledTimes(1);
  });
  expect(screen.getByTestId("route-back").dataset["route"]).toBe(
    "/create-token",
  );
  expect(backHeld()).toBe("true");
  markCreating();
  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith("/token-status", {
      replace: true,
    });
  });
  await waitFor(() => {
    expect(backHeld()).toBe("false");
  });
});

it("holds Back while the token is created and shows none once it is", () => {
  // TokenStatus is an observer, so each state gets a fresh render.
  mockCreating = { name: "Test token", creating: true };
  const creating = render(<TokenStatus />);
  expect(screen.getByTestId("route-back").dataset["route"]).toBe(
    "/token-status",
  );
  expect(backHeld()).toBe("true");
  creating.unmount();

  mockCreating = { name: "Test token", creating: false, error: "Reverted" };
  const failed = render(<TokenStatus />);
  expect(backHeld()).toBe("false");
  failed.unmount();

  // Created: the flow ends with Done.
  mockCreating = { name: "Test token", creating: false };
  render(<TokenStatus />);
  expect(screen.queryByTestId("route-back")).toBeNull();
});
