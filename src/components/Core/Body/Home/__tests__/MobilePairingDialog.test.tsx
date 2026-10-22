/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import MobilePairingDialog from "../AccountCreateImport/MobilePairingDialog";
import { copyToClipboard } from "@/utils/nativeApp";
import { logger } from "@/utils/log";

const logError = jest.spyOn(logger, "error");

let mockStatus: ((status: string) => void) | undefined;
const mockUnsubscribe = jest.fn();
jest.mock("@/utils/mobileConnect/mobileConnection", () => ({
  subscribeMobileStatus: (callback: (status: string) => void) => {
    mockStatus = callback;
    return mockUnsubscribe;
  },
}));
jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(() => Promise.resolve(true)),
}));
jest.mock("@/utils/log", () => ({ logger: { error: jest.fn() } }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it("copies the pairing URI and reports a rejected clipboard operation", async () => {
  const error = new Error("Clipboard unavailable");
  jest.mocked(copyToClipboard).mockRejectedValueOnce(error);
  render(
    <MobilePairingDialog
      uri="qrlconnect://fixture"
      installHint={null}
      onClose={jest.fn()}
      onNewCode={() => Promise.resolve()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith(
      "Failed to copy pairing code:",
      error,
    );
  });
  expect(copyToClipboard).toHaveBeenCalledWith("qrlconnect://fixture");
  expect(screen.queryByText("Copied")).toBeNull();
});

it("releases the rotation state after rejection and allows retry", async () => {
  const error = new Error("Rotation failed");
  const rotate = jest.fn(() => Promise.resolve()).mockRejectedValueOnce(error);
  render(
    <MobilePairingDialog
      uri="qrlconnect://fixture"
      installHint={null}
      onClose={jest.fn()}
      onNewCode={rotate}
    />,
  );
  const button = screen.getByRole("button", { name: "New code" });
  fireEvent.click(button);
  expect(button.hasAttribute("disabled")).toBe(true);
  await waitFor(() => {
    expect(button.hasAttribute("disabled")).toBe(false);
  });
  expect(logError).toHaveBeenCalledWith(
    "Failed to rotate pairing code:",
    error,
  );
  fireEvent.click(button);
  await waitFor(() => {
    expect(rotate).toHaveBeenCalledTimes(2);
  });
});

it("reports asynchronous close failure and unsubscribes on unmount", async () => {
  const error = new Error("Cancellation failed");
  const close = jest.fn(() => Promise.reject(error));
  const view = render(
    <MobilePairingDialog
      uri="qrlconnect://fixture"
      installHint={null}
      onClose={close}
      onNewCode={() => Promise.resolve()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith(
      "Failed to close mobile pairing:",
      error,
    );
  });
  expect(close).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});

it.each([
  "connecting",
  "waiting",
  "key_exchange",
  "connected",
  "reconnecting",
  "disconnected",
  "Unexpected relay failure <detail>",
])("preserves origin/dev mobile status %s", (status) => {
  const hint =
    "MyQRLWallet app not detected. Install it (https://store.example/app?id=wallet) or scan the code with the app on another device.";
  render(
    <MobilePairingDialog
      uri="qrlconnect://fixture"
      installHint={hint}
      onClose={jest.fn()}
      onNewCode={() => Promise.resolve()}
    />,
  );
  act(() => {
    mockStatus?.(status);
  });
  expect(screen.getByText(status).textContent).toBe(status);
  expect(screen.getByText(hint).textContent).toBe(hint);
});
