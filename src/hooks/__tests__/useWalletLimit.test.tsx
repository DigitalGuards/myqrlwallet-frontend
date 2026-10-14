/** @jest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { useWalletLimit } from "../useWalletLimit";
import { StorageUtil } from "@/utils/storage";
import { logger } from "@/utils/log";

jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getMaxWallets: jest.fn(() => 5),
    isWalletLimitReached: jest.fn(),
    getWalletCount: jest.fn(),
  },
}));

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

it("reads the limit before the count and publishes both results together", async () => {
  let resolveLimit: (value: boolean) => void = () => {
    throw new Error("Limit request has not started");
  };
  const limitResult = new Promise<boolean>((resolve) => {
    resolveLimit = resolve;
  });
  const limit = jest
    .spyOn(StorageUtil, "isWalletLimitReached")
    .mockReturnValue(limitResult);
  const count = jest.spyOn(StorageUtil, "getWalletCount").mockResolvedValue(5);
  const { result } = renderHook(() => useWalletLimit("TEST_NET"));

  expect(limit).toHaveBeenCalledWith("TEST_NET");
  expect(count).not.toHaveBeenCalled();
  expect(result.current).toEqual({
    isWalletLimitReached: false,
    walletCount: 0,
    maxWallets: 5,
    isLoading: true,
  });

  await act(async () => {
    resolveLimit(true);
    await limitResult;
  });
  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  });
  expect(count).toHaveBeenCalledWith("TEST_NET");
  expect(result.current).toEqual({
    isWalletLimitReached: true,
    walletCount: 5,
    maxWallets: 5,
    isLoading: false,
  });
});

it.each(["limit", "count"])(
  "reports a rejected %s read and retains the last completed state",
  async (stage) => {
    const limit = jest
      .spyOn(StorageUtil, "isWalletLimitReached")
      .mockResolvedValue(true);
    const count = jest
      .spyOn(StorageUtil, "getWalletCount")
      .mockResolvedValue(5);
    const logged = jest.spyOn(logger, "error");
    const failure = new Error("Wallet storage unavailable");
    const { result, rerender } = renderHook(
      ({ blockchain }) => useWalletLimit(blockchain),
      { initialProps: { blockchain: "TEST_NET" } },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    if (stage === "limit") limit.mockRejectedValueOnce(failure);
    else count.mockRejectedValueOnce(failure);
    rerender({ blockchain: "MAIN_NET" });
    await waitFor(() => {
      expect(logged).toHaveBeenCalledWith(
        "Failed to check wallet limit:",
        failure,
      );
    });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({
      isWalletLimitReached: true,
      walletCount: 5,
      maxWallets: 5,
      isLoading: true,
    });
    expect(count).toHaveBeenCalledTimes(stage === "limit" ? 1 : 2);
  },
);

it("waits for a selected blockchain before reading storage", () => {
  const limit = jest.spyOn(StorageUtil, "isWalletLimitReached");
  const count = jest.spyOn(StorageUtil, "getWalletCount");
  const { result } = renderHook(() => useWalletLimit(undefined));
  expect(limit).not.toHaveBeenCalled();
  expect(count).not.toHaveBeenCalled();
  expect(result.current.isLoading).toBe(true);
});
