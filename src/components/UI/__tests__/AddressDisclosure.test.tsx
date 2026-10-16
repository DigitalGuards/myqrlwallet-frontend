/** @jest-environment jsdom */

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { copyToClipboard } from "@/utils/nativeApp";
import { logError } from "@/utils/log";
import { AddressDisclosure } from "../AddressDisclosure";

jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(() => Promise.resolve(true)),
}));
jest.mock("@/utils/log", () => ({ logError: jest.fn() }));

const ADDRESS =
  "Qd5812F6Cf4a0f645aa620cd57319a0Ed649dd8f5519A9dde7770ae5b0E49e547985f35eB972A2a07041561aa39c65A3991478f9B1e6749e05277dcf58A9A8B72";

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  jest.useRealTimers();
});

function pendingCopy() {
  let complete: (success: boolean) => void = () => {
    throw new Error("Copy promise is uninitialized");
  };
  const promise = new Promise<boolean>((resolve) => {
    complete = resolve;
  });
  return { promise, complete };
}

describe("AddressDisclosure", () => {
  it("shows the three-part fingerprint and keeps the exact address for assistive technology", () => {
    const view = render(<AddressDisclosure address={ADDRESS} />);

    expect(view.getByText("Qd5812F6C...e547985f...8A9A8B72")).toBeTruthy();
    expect(view.getByTitle(ADDRESS)).toBeTruthy();
    expect(view.getAllByText(ADDRESS).length).toBeGreaterThan(0);
    expect(view.queryByTestId("address-disclosure-full")).toBeNull();
  });

  it("keeps the screen-reader twin out of a manual text selection", () => {
    const view = render(<AddressDisclosure address={ADDRESS} />);

    const twin = view.getByText(ADDRESS);
    expect(twin.className).toContain("sr-only");
    expect(twin.className).toContain("select-none");
  });

  it("reveals the complete address in groups of five and collapses again", () => {
    const view = render(<AddressDisclosure address={ADDRESS} />);

    const reveal = view.getByRole("button", { name: "Show full address" });
    expect(reveal.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(reveal);

    const full = view.getByTestId("address-disclosure-full");
    const hide = view.getByRole("button", { name: "Hide full address" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    expect(hide.getAttribute("aria-controls")).toBe(full.getAttribute("id"));

    const revealed = view.getByTestId("address-disclosure-full-text");
    const tokens = Array.from(revealed.children).map(
      (group) => group.textContent,
    );
    expect(tokens[0]).toBe("Q");
    expect(tokens[1]).toBe("d5812");
    expect(tokens.slice(1).every((group) => group.length <= 5)).toBe(true);
    expect(tokens.join("")).toBe(ADDRESS);
    // A drag-copy of the revealed address yields the address itself.
    expect(revealed.textContent).toBe(ADDRESS);
    expect(full.querySelector(".sr-only")).toBeNull();

    fireEvent.click(hide);
    expect(view.queryByTestId("address-disclosure-full")).toBeNull();
  });

  it("copies the exact unmodified address and confirms it", async () => {
    const view = render(<AddressDisclosure address={ADDRESS} />);

    fireEvent.click(view.getByRole("button", { name: "Copy address" }));

    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalledWith(ADDRESS);
    });
    await waitFor(() => {
      expect(view.getByRole("button", { name: "Address copied" })).toBeTruthy();
    });
  });

  it("starts each copy immediately and applies results in completion order", async () => {
    const first = pendingCopy();
    const second = pendingCopy();
    jest
      .mocked(copyToClipboard)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const view = render(<AddressDisclosure address={ADDRESS} />);
    fireEvent.click(view.getByRole("button", { name: "Copy address" }));

    const nextAddress = `Q${"1".repeat(128)}`;
    view.rerender(<AddressDisclosure address={nextAddress} />);
    fireEvent.click(view.getByRole("button", { name: "Copy address" }));
    expect(jest.mocked(copyToClipboard).mock.calls).toEqual([
      [ADDRESS],
      [nextAddress],
    ]);

    await act(() => {
      second.complete(true);
      return second.promise;
    });
    expect(view.getByRole("button", { name: "Address copied" })).toBeTruthy();

    await act(() => {
      first.complete(false);
      return first.promise;
    });
    expect(view.getByRole("button", { name: "Copy address" })).toBeTruthy();
    expect(logError).not.toHaveBeenCalled();
  });

  it("reports a rejected copy and retains the existing confirmation", async () => {
    const view = render(<AddressDisclosure address={ADDRESS} />);
    fireEvent.click(view.getByRole("button", { name: "Copy address" }));
    await waitFor(() => {
      expect(view.getByRole("button", { name: "Address copied" })).toBeTruthy();
    });

    const error = new Error("Clipboard bridge unavailable");
    jest.mocked(copyToClipboard).mockRejectedValueOnce(error);
    fireEvent.click(view.getByRole("button", { name: "Address copied" }));
    await waitFor(() => {
      expect(logError).toHaveBeenCalledWith(
        "Failed to copy text to clipboard:",
        error,
      );
    });
    expect(view.getByRole("button", { name: "Address copied" })).toBeTruthy();
  });

  it("expires confirmation after 1500 milliseconds and clears the timer on unmount", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
    const view = render(<AddressDisclosure address={ADDRESS} />);
    await act(() => {
      fireEvent.click(view.getByRole("button", { name: "Copy address" }));
      return Promise.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(1499);
    });
    expect(view.getByRole("button", { name: "Address copied" })).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(view.getByRole("button", { name: "Copy address" })).toBeTruthy();

    await act(() => {
      fireEvent.click(view.getByRole("button", { name: "Copy address" }));
      return Promise.resolve();
    });
    expect(jest.getTimerCount()).toBe(1);
    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
