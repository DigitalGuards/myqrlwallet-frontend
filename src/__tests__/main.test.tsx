/** @jest-environment jsdom */

import type { ReactNode } from "react";
import { waitFor } from "@testing-library/react";
import WalletLoadFailed from "@/components/WalletLoadFailed";
import { logger } from "@/utils/log";

const mockRender = jest.fn((_node: ReactNode) => undefined);
const mockChunkFailure = new Error("Wallet chunk unavailable");

jest.mock("react-dom/client", () => ({
  __esModule: true,
  default: {
    createRoot: () => ({
      render: (node: ReactNode) => {
        mockRender(node);
      },
    }),
  },
}));
jest.mock("../App", () => {
  throw mockChunkFailure;
});
jest.mock("@/utils/zodJitless", () => ({}));
jest.mock("@/services/dappConnect/fragmentCapture", () => ({
  captureQrlconnectFragment: jest.fn(),
}));
jest.mock("@/utils/embeddedShell", () => ({ installEmbeddedShell: jest.fn() }));
jest.mock("@/utils/embeddedMigrationBoot", () => ({}));
jest.mock("@/utils/nativeApp", () => ({ isRetiredNativeApp: () => false }));
jest.mock("@/utils/embeddedRuntime", () => ({ HAS_NATIVE_BRIDGE: false }));
jest.mock("@/components/RetiredAppNotice", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/WalletLoadFailed", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@fontsource-variable/sora/index.css", () => ({}));
jest.mock("@fontsource-variable/instrument-sans/index.css", () => ({}));
jest.mock("@fontsource-variable/inter/index.css", () => ({}));
jest.mock("@fontsource-variable/jetbrains-mono/index.css", () => ({}));
jest.mock("../index.css", () => ({}));

afterEach(() => {
  document.body.replaceChildren();
  jest.restoreAllMocks();
});

it("reports a failed wallet import and renders the recovery screen", async () => {
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  const logged = jest
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);

  await import("../main");
  await waitFor(() => {
    expect(logged).toHaveBeenCalledWith(
      "[boot] could not load the wallet",
      mockChunkFailure,
    );
    expect(mockRender).toHaveBeenCalledWith(
      expect.objectContaining({ type: WalletLoadFailed }),
    );
  });
  expect(logged).toHaveBeenCalledTimes(1);
  expect(mockRender).toHaveBeenCalledTimes(1);
});
