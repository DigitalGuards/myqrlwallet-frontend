/** @jest-environment jsdom */
import {
  isQualifiedV3NativeContext,
  isUnsupportedV3Context,
  readNativeCapabilities,
} from "../runtimeProfile";
import { malformed } from "@/test-utils/malformed";

// The native bridge exists only in the embedded build, which the app ships.
jest.mock("@/utils/embeddedRuntime", () => ({
  ...jest.requireActual<typeof import("@/utils/embeddedRuntime")>(
    "@/utils/embeddedRuntime",
  ),
  IS_EMBEDDED_BUILD: true,
  HAS_NATIVE_BRIDGE: true,
}));

const network = {
  chainId: "0x301825",
  genesisHash: `0x${"ab".repeat(32)}`,
  networkProfile: "v3-private",
};
const capabilities = {
  bridgeVersion: 1,
  addressScheme: "qip55-64",
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
  return jest.requireActual<typeof import("../runtimeProfile")>(
    "../runtimeProfile",
  );
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
  expect(readNativeCapabilities()).toEqual(capabilities);
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

it("qualifies a mainnet build only against a v3-mainnet record with its own pins", () => {
  const mainnet = {
    chainId: "0x1",
    genesisHash: `0x${"cd".repeat(32)}`,
    networkProfile: "v3-mainnet",
  };
  Object.defineProperty(globalThis, "__QRL_NATIVE_NETWORK__", {
    value: mainnet,
    configurable: true,
  });
  // The existing testnet app record does not qualify for a mainnet build.
  expect(isQualifiedV3NativeContext()).toBe(false);
  nativeBridge().injectedObjectJson = () =>
    JSON.stringify({ qrlWalletCapabilities: { ...capabilities, ...mainnet } });
  expect(isQualifiedV3NativeContext()).toBe(true);
  // A mainnet profile carrying the testnet pins is still refused.
  nativeBridge().injectedObjectJson = () =>
    JSON.stringify({
      qrlWalletCapabilities: { ...capabilities, networkProfile: "v3-mainnet" },
    });
  expect(isQualifiedV3NativeContext()).toBe(false);
});

it("refuses a v3-mainnet record in a testnet build", () => {
  nativeBridge().injectedObjectJson = () =>
    JSON.stringify({
      qrlWalletCapabilities: { ...capabilities, networkProfile: "v3-mainnet" },
    });
  expect(isQualifiedV3NativeContext()).toBe(false);
});

it.each([null, "", "{", "null", "[]", "{}", "x".repeat(4097)])(
  "rejects missing or malformed injected metadata: %s",
  (value) => {
    nativeBridge().injectedObjectJson = () => value;
    expect(readNativeCapabilities()).toBeNull();
    expect(isQualifiedV3NativeContext()).toBe(false);
  },
);

it.each([null, true, 1, "capabilities", []])(
  "rejects a non-record capability value: %p",
  (value) => {
    nativeBridge().injectedObjectJson = () =>
      JSON.stringify({ qrlWalletCapabilities: value });
    expect(readNativeCapabilities()).toBeNull();
    expect(isUnsupportedV3Context()).toBe(true);
  },
);

it.each([true, 1, {}, []])(
  "rejects a non-string injection result: %p",
  (value) => {
    nativeBridge().injectedObjectJson = () => malformed<string>(value);
    expect(readNativeCapabilities()).toBeNull();
    expect(isUnsupportedV3Context()).toBe(true);
  },
);

it("preserves additional capability fields while checking the required identity", () => {
  const extended = { ...capabilities, deviceCredential: true };
  nativeBridge().injectedObjectJson = () =>
    JSON.stringify({ qrlWalletCapabilities: extended });
  expect(readNativeCapabilities()).toEqual(extended);
  expect(isQualifiedV3NativeContext()).toBe(true);
});

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

describe("desktop shell network metadata", () => {
  // The desktop preload advertises its build's network beside addressScheme.
  function desktopShell(advertised?: unknown) {
    delete window.ReactNativeWebView;
    jest
      .spyOn(navigator, "userAgent", "get")
      .mockReturnValue("Mozilla/5.0 Electron/44.10.0");
    window.qrlWallet = malformed<NonNullable<typeof window.qrlWallet>>({
      addressScheme: "qip55-64",
      ...(advertised === undefined ? {} : { network: advertised }),
    });
  }

  afterEach(() => {
    delete window.qrlWallet;
  });

  it("keeps a shell without network metadata supported", () => {
    desktopShell();
    expect(isUnsupportedV3Context()).toBe(false);
  });

  it("accepts the shell built for the renderer's network", () => {
    desktopShell({ ...network });
    expect(isUnsupportedV3Context()).toBe(false);
    // The shell's chain id is hex from a number; the genesis case may differ.
    desktopShell({
      ...network,
      chainId: "0x0301825",
      genesisHash: network.genesisHash.toUpperCase().replace("0X", "0x"),
    });
    expect(isUnsupportedV3Context()).toBe(false);
  });

  it.each([
    ["networkProfile", "v3-mainnet"],
    ["chainId", "0x1"],
    ["chainId", 3151909],
    ["genesisHash", `0x${"cd".repeat(32)}`],
    ["genesisHash", null],
  ])("refuses a shell whose %s is %p", (field, value) => {
    desktopShell({ ...network, [field]: value });
    expect(isUnsupportedV3Context()).toBe(true);
  });

  it.each([null, "v3-private", [network]])(
    "refuses malformed shell network metadata %p",
    (value) => {
      desktopShell(value);
      expect(isUnsupportedV3Context()).toBe(true);
    },
  );

  it("refuses a testnet shell under a mainnet renderer", () => {
    Object.defineProperty(globalThis, "__QRL_NATIVE_NETWORK__", {
      value: {
        chainId: "0x1",
        genesisHash: `0x${"cd".repeat(32)}`,
        networkProfile: "v3-mainnet",
      },
      configurable: true,
    });
    desktopShell({ ...network });
    expect(isUnsupportedV3Context()).toBe(true);
  });
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
