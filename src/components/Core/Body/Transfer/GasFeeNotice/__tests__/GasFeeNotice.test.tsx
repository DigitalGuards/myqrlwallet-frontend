/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { quoteFees } from "@/stores/qrlStore";
import { GasFeeNotice } from "../GasFeeNotice";

const mockEstimate = jest.fn<Promise<unknown>, [unknown]>();
let mockProvider = { estimateGas: mockEstimate };
const onQuote = jest.fn();
const onFeeLevelChange = jest.fn();
const fees = {
  maxFeePerGas: 5n,
  maxPriorityFeePerGas: 1n,
  expectedFeePerGas: 3n,
  baseFeePerGas: 2n,
};

jest.mock("@/stores/store", () => ({
  useStore: () => ({ qrlStore: { qrlInstance: mockProvider } }),
}));
jest.mock("@/stores/qrlStore", () => ({ quoteFees: jest.fn() }));

const props = {
  from: "sender",
  to: "recipient",
  value: "1",
  isSubmitting: false,
  feeLevel: "medium" as const,
  onQuote,
  onFeeLevelChange,
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockEstimate.mockResolvedValue(21000n);
  mockProvider = { estimateGas: mockEstimate };
  jest.mocked(quoteFees).mockResolvedValue(fees);
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

async function quoteAfterDebounce() {
  await act(() => jest.advanceTimersByTimeAsync(500));
}

it("quotes after the debounce and keeps the exact gas limit and fees", async () => {
  render(<GasFeeNotice {...props} />);
  expect(mockEstimate).not.toHaveBeenCalled();
  await quoteAfterDebounce();
  expect(mockEstimate).toHaveBeenCalledWith({
    from: "sender",
    to: "recipient",
    value: "1000000000000000000",
  });
  expect(onQuote.mock.calls).toEqual([
    [null],
    [{ quote: fees, gasLimit: 21000n }],
  ]);
  expect(screen.queryByText("Estimating fee...")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Fast" }));
  expect(onFeeLevelChange).toHaveBeenCalledWith("high");
});

it("refreshes the quote when the provider changes", async () => {
  const view = render(<GasFeeNotice {...props} />);
  await quoteAfterDebounce();
  const nextEstimate = jest
    .fn<Promise<unknown>, [unknown]>()
    .mockResolvedValue(42000n);
  mockProvider = { estimateGas: nextEstimate };
  view.rerender(<GasFeeNotice {...props} />);
  await quoteAfterDebounce();
  expect(nextEstimate).toHaveBeenCalledTimes(1);
  expect(onQuote).toHaveBeenLastCalledWith({ quote: fees, gasLimit: 42000n });
});

it.each([{}, -1n, "garbage"])(
  "fails closed on an invalid estimate: %s",
  async (estimate) => {
    mockEstimate.mockResolvedValue(estimate);
    render(<GasFeeNotice {...props} />);
    await quoteAfterDebounce();
    expect(screen.getByText("Error: Invalid gas estimate")).toBeTruthy();
    expect(onQuote.mock.calls).toEqual([[null], [null]]);
  },
);

it.each([
  new Error("RPC unavailable"),
  "RPC unavailable",
  { reason: "RPC unavailable" },
])("handles rejected estimates: %s", async (error) => {
  mockEstimate.mockRejectedValueOnce(error);
  render(<GasFeeNotice {...props} />);
  await quoteAfterDebounce();
  expect(screen.getByText(/RPC unavailable/)).toBeTruthy();
  expect(onQuote).toHaveBeenLastCalledWith(null);
});

it("cancels the pending debounce on unmount", async () => {
  const view = render(<GasFeeNotice {...props} />);
  view.unmount();
  await quoteAfterDebounce();
  expect(mockEstimate).not.toHaveBeenCalled();
});

it("ignores a previous provider's late estimate", async () => {
  let resolveOld: (value: unknown) => void = () => {
    throw new Error("Missing pending estimate");
  };
  mockEstimate.mockReturnValueOnce(
    new Promise<unknown>((resolve) => {
      resolveOld = resolve;
    }),
  );
  const view = render(<GasFeeNotice {...props} />);
  await quoteAfterDebounce();
  mockProvider = {
    estimateGas: jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue(42000n),
  };
  view.rerender(<GasFeeNotice {...props} />);
  await quoteAfterDebounce();
  const count = onQuote.mock.calls.length;
  await act(() => {
    resolveOld(21000n);
    return Promise.resolve();
  });
  expect(onQuote).toHaveBeenCalledTimes(count);
  expect(onQuote).toHaveBeenLastCalledWith({ quote: fees, gasLimit: 42000n });
});

it("ignores a late rejection after unmount", async () => {
  let rejectOld: (reason: unknown) => void = () => {
    throw new Error("Missing pending estimate");
  };
  mockEstimate.mockReturnValueOnce(
    new Promise<unknown>((_resolve, reject) => {
      rejectOld = reject;
    }),
  );
  const view = render(<GasFeeNotice {...props} />);
  await quoteAfterDebounce();
  view.unmount();
  await act(() => {
    rejectOld(new Error("Late failure"));
    return Promise.resolve();
  });
  expect(onQuote.mock.calls).toEqual([[null]]);
});
