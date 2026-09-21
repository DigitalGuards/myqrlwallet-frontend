/** @jest-environment jsdom */
import {
  isQualifiedV3NativeContext,
  isUnsupportedV3Context,
} from "../runtimeProfile";

const network = { chainId: "0x301825", genesisHash: `0x${"ab".repeat(32)}` };
const capabilities = {
  bridgeVersion: 1,
  addressScheme: "qip55-64",
  networkProfile: "v3-private",
  ...network,
};

function nativeBridge() {
  const bridge = window.ReactNativeWebView;
  if (!bridge) throw new Error("Test native bridge is missing");
  return bridge;
}

jest.mock("../runtimeProfile", () => {
  Object.defineProperty(globalThis, "__QRL_WALLET_PROFILE__", {
    value: "v3-private",
    configurable: true,
  });
  return jest.requireActual("../runtimeProfile");
});

beforeEach(() => {
  Object.defineProperty(globalThis, "__QRL_NATIVE_NETWORK__", {
    value: network,
    configurable: true,
  });
  jest
    .spyOn(navigator, "userAgent", "get")
    .mockReturnValue("MyQRLWallet/1.3.0");
  window.ReactNativeWebView = {
    postMessage: jest.fn(),
    injectedObjectJson: () =>
      JSON.stringify({ qrlWalletCapabilities: capabilities }),
  };
});

afterEach(() => {
  delete window.ReactNativeWebView;
  jest.restoreAllMocks();
});

it("accepts only the configured v3 mobile profile", () => {
  expect(isQualifiedV3NativeContext()).toBe(true);
  expect(isUnsupportedV3Context()).toBe(false);
});

it.each([
  ["bridgeVersion", 2],
  ["addressScheme", "qrl-20"],
  ["networkProfile", "testnet-v2"],
  ["chainId", "0x539"],
  ["genesisHash", `0x${"cd".repeat(32)}`],
])("rejects a mismatched %s", (field, value) => {
  nativeBridge().injectedObjectJson = () =>
    JSON.stringify({
      qrlWalletCapabilities: { ...capabilities, [field]: value },
    });
  expect(isQualifiedV3NativeContext()).toBe(false);
  expect(isUnsupportedV3Context()).toBe(true);
});

it.each([null, "", "{", "null", "[]", "{}", "x".repeat(4097)])(
  "rejects missing or malformed injected metadata: %s",
  (value) => {
    nativeBridge().injectedObjectJson = () => value;
    expect(isQualifiedV3NativeContext()).toBe(false);
  },
);

it("keeps old native builds blocked and permits a later capability injection", () => {
  delete nativeBridge().injectedObjectJson;
  expect(isUnsupportedV3Context()).toBe(true);
  nativeBridge().injectedObjectJson = () =>
    JSON.stringify({
      qrlWalletCapabilities: capabilities,
    });
  expect(isUnsupportedV3Context()).toBe(false);
});

it("fails closed when injection throws or build identity is absent", () => {
  nativeBridge().injectedObjectJson = () => {
    throw new Error("unavailable");
  };
  expect(isQualifiedV3NativeContext()).toBe(false);
  Object.defineProperty(globalThis, "__QRL_NATIVE_NETWORK__", {
    value: null,
    configurable: true,
  });
  expect(isQualifiedV3NativeContext()).toBe(false);
});

it("requires the native bridge and application context", () => {
  jest.spyOn(navigator, "userAgent", "get").mockReturnValue("Browser");
  expect(isQualifiedV3NativeContext()).toBe(false);
  delete window.ReactNativeWebView;
  expect(isUnsupportedV3Context()).toBe(false);
});

it("preserves exact document binding and rechecks capability for bridge messages", () => {
  const native = jest.requireActual<typeof import("../../utils/nativeApp")>(
    "../../utils/nativeApp",
  );
  const received = jest.fn();
  const unsubscribe = native.subscribeToNativeMessages(received);
  expect(native.sendToNative("WEB_APP_READY")).toBe(true);
  expect(nativeBridge().postMessage).toHaveBeenCalledWith(
    JSON.stringify({
      type: "WEB_APP_READY",
      payload: { documentId: native.getCurrentNativeDocumentId() },
    }),
  );
  const deliver = (documentId: string) =>
    window.dispatchEvent(
      new CustomEvent("nativeMessage", {
        detail: {
          type: "APP_STATE",
          payload: { state: "background", documentId },
        },
      }),
    );
  deliver("stale-document");
  expect(received).not.toHaveBeenCalled();
  deliver(native.getCurrentNativeDocumentId());
  expect(received).toHaveBeenCalledTimes(1);
  delete nativeBridge().injectedObjectJson;
  deliver(native.getCurrentNativeDocumentId());
  expect(received).toHaveBeenCalledTimes(1);
  expect(native.sendToNative("WEB_APP_READY")).toBe(false);
  unsubscribe();
});
