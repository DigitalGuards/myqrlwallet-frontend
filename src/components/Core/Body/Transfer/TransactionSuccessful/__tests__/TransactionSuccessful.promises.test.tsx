/** @jest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { SendReceipt } from "@/utils/sendStatus";
import { reportError } from "@/utils/reportError";
import { TransactionSuccessful } from "../TransactionSuccessful";

const mockCopy = jest.fn<Promise<boolean>, [string]>();
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) =>
    values.filter((value) => typeof value === "string").join(" "),
}));
jest.mock("@/stores/store", () => ({
  useStore: () => ({ qrlStore: { qrlConnection: { blockchain: "TEST_NET" } } }),
}));
jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: (text: string) => mockCopy(text),
}));
jest.mock("@/utils/reportError", () => ({ reportError: jest.fn() }));
jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));
jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { explorer: "https://explorer.example" } },
}));
const receipt: SendReceipt = {
  transactionHash: `0x${"a".repeat(64)}`,
  blockHash: `0x${"b".repeat(64)}`,
  blockNumber: 42n,
  gasUsed: 21000n,
  status: 1n,
};
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it.each(["transaction", "block"])(
  "reports rejected %s hash copying while retaining the receipt",
  async (kind) => {
    const error = new Error("Clipboard unavailable");
    mockCopy.mockRejectedValueOnce(error);
    render(
      <TransactionSuccessful transactionReceipt={receipt} onDone={jest.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: `Copy ${kind} hash` }));
    await waitFor(() => {
      expect(reportError).toHaveBeenCalledWith("Failed to copy hash:", error);
    });
    expect(screen.getByRole("heading").textContent).toBe(
      "Transaction Completed",
    );
    expect(
      screen.getByRole("button", { name: `Copy ${kind} hash` }),
    ).toBeTruthy();
  },
);
