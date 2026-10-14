/** @jest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import MyQRLWallet from "../MyQRLWallet";
import { clearAutoLockTimer, setupActivityTracking, startAutoLockTimer } from "@/utils/storage";
import { logger } from "@/utils/log";

const mockNavigate = jest.fn(() => Promise.resolve());
const logError = jest.spyOn(logger, "error");
jest.mock("react-router", () => ({ useNavigate: () => mockNavigate }));
jest.mock("mobx-react-lite", () => ({ observer: (component: unknown) => component }));
jest.mock("@/utils/react", () => ({ withSuspense: () => () => null }));
jest.mock("../Layout/Layout", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("../Body/Body", () => () => null);
jest.mock("../RouteMonitor/RouteMonitor", () => () => null);
jest.mock("@/components/NativeAppBridge", () => () => null);
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("@/utils/embeddedRuntime", () => ({ HAS_NATIVE_BRIDGE: false }));
jest.mock("@/utils/log", () => ({ logger: { error: jest.fn() } }));
jest.mock("@/utils/storage", () => ({
  startAutoLockTimer: jest.fn(() => Promise.resolve()),
  setupActivityTracking: jest.fn(),
  clearAutoLockTimer: jest.fn(),
}));
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it("reports timer setup rejection and still cleans up on unmount", async () => {
  const error = new Error("Timer setup failed");
  jest.mocked(startAutoLockTimer).mockRejectedValueOnce(error);
  const view = render(<MyQRLWallet />);
  expect(setupActivityTracking).toHaveBeenCalledTimes(1);
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to start auto-lock timer:", error);
  });
  view.unmount();
  expect(clearAutoLockTimer).toHaveBeenCalledTimes(1);
});

it("preserves the lock destination and handles navigation rejection", async () => {
  const error = new Error("Navigation failed");
  mockNavigate.mockRejectedValueOnce(error);
  render(<MyQRLWallet />);
  const navigate = jest.mocked(startAutoLockTimer).mock.calls[0]?.[0];
  if (!navigate) throw new Error("Auto-lock callback is missing");
  navigate("/locked");
  await waitFor(() => {
    expect(logError).toHaveBeenCalledWith("Failed to navigate after auto-lock:", error);
  });
  expect(mockNavigate).toHaveBeenCalledWith("/locked");
});
