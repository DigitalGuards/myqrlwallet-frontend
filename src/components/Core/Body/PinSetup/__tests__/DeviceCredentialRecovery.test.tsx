/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DeviceCredentialRecovery } from "../DeviceCredentialRecovery";
jest.mock("@/utils", () => jest.requireActual("@/utils/cn"));

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  delete window.ReactNativeWebView;
  localStorage.clear();
});

it("opens native settings without requesting deletion or creating a credential", () => {
  jest
    .spyOn(navigator, "userAgent", "get")
    .mockReturnValue("MyQRLWallet/1.3.1");
  const postMessage = jest.fn();
  window.ReactNativeWebView = { postMessage };
  localStorage.setItem(
    "TEST_NET_V3_ENCRYPTED_SEEDS",
    "preserved current wallet",
  );
  localStorage.setItem("TEST_NET_ENCRYPTED_SEEDS", "preserved earlier wallet");

  render(<DeviceCredentialRecovery />);
  expect(screen.getByRole("alert").textContent).toContain(
    "Close and reopen the app",
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "every wallet, including wallets saved under earlier network profiles",
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "independently usable exported backup",
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "authentication and confirmation steps",
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "Keep all wallet data if any recovery backup is missing",
  );
  expect(postMessage).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Open app settings" }));
  expect(postMessage).toHaveBeenCalledTimes(1);
  expect(JSON.parse(postMessage.mock.calls[0]?.[0] as string).type).toBe(
    "OPEN_NATIVE_SETTINGS",
  );
  expect(localStorage.getItem("TEST_NET_V3_ENCRYPTED_SEEDS")).toBe(
    "preserved current wallet",
  );
  expect(localStorage.getItem("TEST_NET_ENCRYPTED_SEEDS")).toBe(
    "preserved earlier wallet",
  );
});

it("offers a separate browser profile while preserving existing wallet data", () => {
  render(<DeviceCredentialRecovery />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain(
    "separate browser profile",
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "Keep this browser profile and its wallet data until every wallet is recovered",
  );
});
