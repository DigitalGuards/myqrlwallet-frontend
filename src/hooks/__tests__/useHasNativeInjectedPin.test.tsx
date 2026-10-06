/** @jest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { useHasNativeInjectedPin } from "@/hooks/useHasNativeInjectedPin";
import {
  clearNativeInjectedPin,
  setNativeInjectedPin,
  subscribeNativeInjectedPin,
} from "@/utils/nativeApp";

function PinField() {
  const hasNativePin = useHasNativeInjectedPin();
  return <p>{hasNativePin ? "native pin" : "pin field"}</p>;
}

describe("useHasNativeInjectedPin", () => {
  afterEach(() => {
    clearNativeInjectedPin();
  });

  it("re-renders an open screen when Device Login injects the PIN, and again when it is cleared", () => {
    render(<PinField />);
    expect(screen.getByText("pin field")).toBeTruthy();

    act(() => setNativeInjectedPin("135790"));
    expect(screen.getByText("native pin")).toBeTruthy();

    act(() => clearNativeInjectedPin());
    expect(screen.getByText("pin field")).toBeTruthy();
  });

  it("treats an empty PIN as no PIN and notifies only on a real change", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeNativeInjectedPin(listener);
    setNativeInjectedPin("");
    expect(listener).not.toHaveBeenCalled();
    setNativeInjectedPin("135790");
    setNativeInjectedPin("135790");
    expect(listener).toHaveBeenCalledTimes(1);
    clearNativeInjectedPin();
    clearNativeInjectedPin();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeNativeInjectedPin(listener);
    setNativeInjectedPin("135790");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    clearNativeInjectedPin();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
