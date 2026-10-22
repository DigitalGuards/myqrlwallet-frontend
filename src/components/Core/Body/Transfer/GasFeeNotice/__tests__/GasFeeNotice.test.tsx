/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { quoteFees } from "@/stores/qrlStore";
import { deferred } from "@/test-utils/deferred";
import { GasFeeNotice } from "../GasFeeNotice";

const mockEstimate = jest.fn<Promise<unknown>, [unknown]>();
let estimate: ReturnType<typeof deferred<unknown>>;
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
  estimate = deferred<unknown>();
  mockEstimate.mockReturnValue(estimate.promise);
  mockProvider = { estimateGas: mockEstimate };
  jest.mocked(quoteFees).mockResolvedValue(fees);
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

async function startQuoteAfterDebounce() {
  await act(() => jest.advanceTimersByTimeAsync(500));
}

it("quotes after the debounce and keeps the exact gas limit and fees", async () => {
  render(<GasFeeNotice {...props} />);
  expect(mockEstimate).not.toHaveBeenCalled();
  await startQuoteAfterDebounce();
  expect(mockEstimate).toHaveBeenCalledWith({
    from: "sender",
    to: "recipient",
    value: "1000000000000000000",
  });
  expect(screen.getByText("Estimating fee...")).toBeTruthy();
  expect(onQuote.mock.calls).toEqual([[null]]);
  await act(async () => {
    estimate.resolve(21000n);
    await estimate.promise;
  });
  expect(onQuote.mock.calls).toEqual([
    [null],
    [{ quote: fees, gasLimit: 21000n }],
  ]);
  expect(screen.queryByText("Estimating fee...")).toBeNull();
  expect(screen.getByText("≈ 0.000000000000063 Quanta")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Fast" }));
  expect(onFeeLevelChange).toHaveBeenCalledWith("high");
});

it("refreshes the quote when the provider changes", async () => {
  const view = render(<GasFeeNotice {...props} />);
  await startQuoteAfterDebounce();
  await act(async () => {
    estimate.resolve(21000n);
    await estimate.promise;
  });
  const next = deferred<unknown>();
  const nextEstimate = jest
    .fn<Promise<unknown>, [unknown]>()
    .mockReturnValue(next.promise);
  mockProvider = { estimateGas: nextEstimate };
  view.rerender(<GasFeeNotice {...props} />);
  await startQuoteAfterDebounce();
  expect(nextEstimate).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Estimating fee...")).toBeTruthy();
  expect(onQuote).toHaveBeenLastCalledWith(null);
  await act(async () => {
    next.resolve(42000n);
    await next.promise;
  });
  expect(onQuote).toHaveBeenLastCalledWith({ quote: fees, gasLimit: 42000n });
});

it.each([{}, -1n, "garbage"])(
  "fails closed on an invalid estimate: %s",
  async (invalidEstimate) => {
    render(<GasFeeNotice {...props} />);
    await startQuoteAfterDebounce();
    expect(screen.getByText("Estimating fee...")).toBeTruthy();
    await act(async () => {
      estimate.resolve(invalidEstimate);
      await estimate.promise;
    });
    expect(screen.getByText("Error: Invalid gas estimate")).toBeTruthy();
    expect(onQuote.mock.calls).toEqual([[null], [null]]);
  },
);

it.each([
  new Error("RPC unavailable"),
  "RPC unavailable",
  { reason: "RPC unavailable" },
])("handles rejected estimates: %s", async (error) => {
  render(<GasFeeNotice {...props} />);
  await startQuoteAfterDebounce();
  expect(screen.getByText("Estimating fee...")).toBeTruthy();
  await act(async () => {
    estimate.reject(error);
    await estimate.promise.catch(() => undefined);
  });
  expect(screen.getByText(/RPC unavailable/)).toBeTruthy();
  expect(onQuote).toHaveBeenLastCalledWith(null);
});

it("cancels the pending debounce on unmount", async () => {
  const view = render(<GasFeeNotice {...props} />);
  view.unmount();
  await startQuoteAfterDebounce();
  expect(mockEstimate).not.toHaveBeenCalled();
});

it("ignores a previous provider's late estimate", async () => {
  const view = render(<GasFeeNotice {...props} />);
  await startQuoteAfterDebounce();
  const next = deferred<unknown>();
  mockProvider = {
    estimateGas: jest
      .fn<Promise<unknown>, [unknown]>()
      .mockReturnValue(next.promise),
  };
  view.rerender(<GasFeeNotice {...props} />);
  await startQuoteAfterDebounce();
  await act(async () => {
    next.resolve(42000n);
    await next.promise;
  });
  const count = onQuote.mock.calls.length;
  await act(async () => {
    estimate.resolve(21000n);
    await estimate.promise;
  });
  expect(onQuote).toHaveBeenCalledTimes(count);
  expect(onQuote).toHaveBeenLastCalledWith({ quote: fees, gasLimit: 42000n });
});

it("ignores a late rejection after unmount", async () => {
  const view = render(<GasFeeNotice {...props} />);
  await startQuoteAfterDebounce();
  view.unmount();
  await act(async () => {
    estimate.reject(new Error("Late failure"));
    await estimate.promise.catch(() => undefined);
  });
  expect(onQuote.mock.calls).toEqual([[null]]);
});
