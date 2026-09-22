/** @jest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { TransactionReceipt } from "@theqrl/web3";
import { useStore } from "@/stores/store";
import { copyToClipboard } from "@/utils/nativeApp";
import { TransactionSuccessful } from "../TransactionSuccessful";

jest.mock("@/stores/store", () => ({ useStore: jest.fn() }));
jest.mock("@/utils", () => jest.requireActual("@/utils/cn"));
jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET_V3: { explorer: "https://zondscan.com" },
    MAIN_NET: { explorer: "https://mainnet.example/explorer" },
  },
}));
jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(async () => true),
}));

const TX_HASH = `0x${"a1".repeat(32)}`;
const BLOCK_HASH = `0x${"b2".repeat(32)}`;
const RECEIPT = {
  transactionHash: TX_HASH,
  blockHash: BLOCK_HASH,
  blockNumber: 155778n,
  gasUsed: 21000n,
  effectiveGasPrice: 1250000000n,
} as TransactionReceipt;

beforeEach(() => {
  jest.mocked(useStore).mockReturnValue({
    qrlStore: { qrlConnection: { blockchain: "TEST_NET_V3" } },
  } as never);
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

function fixture(amount: string | undefined = "40500", assetSymbol = "Quanta") {
  const onDone = jest.fn();
  render(
    <TransactionSuccessful
      transactionReceipt={RECEIPT}
      amount={amount}
      assetSymbol={assetSymbol}
      onDone={onDone}
    />,
  );
  return onDone;
}

it("keeps full hashes readable and full explorer destinations", () => {
  fixture();
  expect(screen.getByRole("heading").textContent).toBe("Transaction Completed");
  expect(screen.getByText(TX_HASH)).toBeTruthy();
  expect(screen.getByText(BLOCK_HASH)).toBeTruthy();
  const txLink = screen.getByRole("link", {
    name: `View transaction ${TX_HASH} on explorer`,
  });
  expect(txLink.getAttribute("href")).toBe(
    `https://zondscan.com/tx/${TX_HASH}`,
  );
  expect(txLink.getAttribute("rel")).toBe("noopener noreferrer");
  expect(txLink.getAttribute("target")).toBe("_blank");
  expect(
    screen.getByRole("link", { name: "155778" }).getAttribute("href"),
  ).toBe("https://zondscan.com/block/155778");
  expect(screen.getByText("40,500.0 Quanta")).toBeTruthy();
  expect(screen.getByText("0.00002625 QRL")).toBeTruthy();
});

it.each([
  ["transaction", TX_HASH, "Transaction hash copied"],
  ["block", BLOCK_HASH, "Block hash copied"],
])(
  "copies the entire %s hash with labeled feedback",
  async (kind, hash, feedback) => {
    fixture();
    const button = screen.getByRole("button", { name: `Copy ${kind} hash` });
    expect(button.getAttribute("type")).toBe("button");
    await act(async () => fireEvent.click(button));
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(copyToClipboard).toHaveBeenCalledWith(hash);
    expect(screen.getByRole("button", { name: feedback })).toBeTruthy();
  },
);

it("does not show copied feedback if the clipboard fails", async () => {
  jest.mocked(copyToClipboard).mockResolvedValueOnce(false);
  fixture();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Copy transaction hash" }),
    );
  });
  expect(
    screen.queryByRole("button", { name: "Transaction hash copied" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Copy transaction hash" }),
  ).toBeTruthy();
});

it("preserves the Done action", () => {
  const onDone = fixture();
  expect(onDone).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(onDone).toHaveBeenCalledTimes(1);
});

it("supports receipts without a displayed amount", () => {
  render(
    <TransactionSuccessful transactionReceipt={RECEIPT} onDone={jest.fn()} />,
  );
  expect(screen.queryByText("Amount")).toBeNull();
  expect(screen.getByText(TX_HASH)).toBeTruthy();
});

it("keeps the selected network's custom explorer", () => {
  jest.mocked(useStore).mockReturnValue({
    qrlStore: { qrlConnection: { blockchain: "MAIN_NET" } },
  } as never);
  fixture();
  expect(
    screen
      .getByRole("link", { name: `View transaction ${TX_HASH} on explorer` })
      .getAttribute("href"),
  ).toBe(`https://mainnet.example/explorer/tx/${TX_HASH}`);
});
