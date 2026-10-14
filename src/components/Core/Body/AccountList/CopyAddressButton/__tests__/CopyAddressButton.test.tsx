/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TextEncoder } from "node:util";
import { CopyAddressButton } from "../CopyAddressButton";
import { copyToClipboard, shareContent } from "@/utils/nativeApp";
import { logger } from "@/utils/log";

const logError = jest.spyOn(logger, "error");

let mockNative = false;
const mockWrite = jest.fn(() => Promise.resolve());
const mockDraw = jest.fn();
const mockFill = jest.fn();
const address = `Q${"12".repeat(64)}`;
const png = new Blob(["fixture"], { type: "image/png" });
const mockClipboardItem = jest.fn();
jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(() => Promise.resolve(true)),
  isInNativeApp: () => mockNative,
  shareContent: jest.fn(() => true),
}));
jest.mock("@/utils/log", () => ({ logger: { error: jest.fn() } }));
jest.mock("@/utils", () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(" ") }));

let image: HTMLImageElement;
let download: jest.SpyInstance<void, []>;
beforeEach(() => {
  jest.clearAllMocks();
  mockNative = false;
  Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: TextEncoder });
  image = document.createElement("img");
  jest.spyOn(globalThis, "Image").mockImplementation(() => image);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write: mockWrite },
  });
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: mockClipboardItem,
  });
  // Only the canvas operations used to paint the QR are needed in jsdom.
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ fillRect: mockFill, drawImage: mockDraw, fillStyle: "" }),
  });
  jest.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
    callback(png);
  });
  jest
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue("data:image/png;base64,Zml4dHVyZQ==");
  download = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function startQr() {
  render(<CopyAddressButton accountAddress={address} />);
  fireEvent.click(screen.getByRole("button", { name: "Show address QR code" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy QR" }));
}

it("paints the padded QR and copies the PNG before showing success", async () => {
  startQr();
  expect(mockWrite).not.toHaveBeenCalled();
  fireEvent.load(image);
  await screen.findByRole("button", { name: "Copied!" });
  expect(mockFill).toHaveBeenCalledWith(0, 0, 40, 40);
  expect(mockDraw).toHaveBeenCalledWith(image, 20, 20);
  expect(mockClipboardItem).toHaveBeenCalledWith({ "image/png": png });
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(download).not.toHaveBeenCalled();
  expect(shareContent).not.toHaveBeenCalled();
});

it.each([false, true])("preserves the clipboard fallback with native=%s", async (native) => {
  mockNative = native;
  mockWrite.mockRejectedValueOnce(new Error("Image clipboard unavailable"));
  startQr();
  fireEvent.load(image);
  await screen.findByRole("button", { name: "Copied!" });
  if (native) {
    expect(shareContent).toHaveBeenCalledWith({ title: "QRL address", text: address });
    expect(download).not.toHaveBeenCalled();
  } else {
    expect(download).toHaveBeenCalledTimes(1);
    expect(shareContent).not.toHaveBeenCalled();
  }
});

it("reports image-loading errors without showing copy success", async () => {
  startQr();
  fireEvent.error(image);
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to copy QR code:", expect.any(Error));
  });
  expect(mockWrite).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Copied!" })).toBeNull();
});

it("contains a fallback failure after clipboard rejection", async () => {
  const error = new Error("Canvas unavailable");
  mockWrite.mockRejectedValueOnce(new Error("Image clipboard unavailable"));
  jest.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementationOnce(() => {
    throw error;
  });
  startQr();
  fireEvent.load(image);
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to copy QR code:", error);
  });
  expect(screen.queryByRole("button", { name: "Copied!" })).toBeNull();
});

it("reports address clipboard rejection without success feedback", async () => {
  const error = new Error("Clipboard unavailable");
  jest.mocked(copyToClipboard).mockRejectedValueOnce(error);
  render(<CopyAddressButton accountAddress={address} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to copy address:", error);
  });
  expect(screen.queryByRole("button", { name: "Address copied" })).toBeNull();
});
