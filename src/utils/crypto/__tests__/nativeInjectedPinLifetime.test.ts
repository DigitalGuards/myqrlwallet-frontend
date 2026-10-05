import { useEffect } from "react";
import NativeAppBridge from "@/components/NativeAppBridge";
import {
  getNativeInjectedPin,
  setNativeInjectedPin,
  subscribeToNativeMessages,
  type NativeMessage,
} from "@/utils/nativeApp";

jest.mock("react", () => ({
  useEffect: jest.fn(),
  useCallback: <T>(callback: T) => callback,
  useRef: <T>(current: T) => ({ current }),
}));
jest.mock("react-router", () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ search: "" }),
}));
jest.mock("@/utils/nativeApp", () => ({
  ...jest.requireActual("@/utils/nativeApp"),
  isInNativeApp: () => true,
  subscribeToNativeMessages: jest.fn(),
  notifyWebAppReady: jest.fn(),
  logToNative: jest.fn(),
}));
let mockCapabilities: Record<string, unknown> | null = null;
jest.mock("@/config/runtimeProfile", () => ({
  ...jest.requireActual("@/config/runtimeProfile"),
  readNativeCapabilities: () => mockCapabilities,
}));
jest.mock("@/utils/storage/storage", () => ({ __esModule: true, default: {} }));
jest.mock("@/utils/crypto/walletEncryption", () => ({
  WalletEncryptionUtil: { validatePin: () => true },
  DeviceCredentialUnavailableError: class extends Error {},
}));
jest.mock("@/utils/crypto/deviceCredential", () => ({}));
jest.mock("@/utils/crypto", () => ({ CryptoErrorCode: {} }));
jest.mock("@/utils/crypto/cryptoWorkerClient", () => ({}));
jest.mock("@/utils/crypto/seedIdentity", () => ({}));
jest.mock("@/utils/crypto/storedSeed", () => ({}));
jest.mock("@/utils/crypto/pinRotation", () => ({}));
jest.mock("@/services/dappConnect/DAppConnectService", () => ({
  DAppConnectService: { isConnectionURI: () => false },
  dappConnectService: { reconnectAll: jest.fn() },
}));
jest.mock("@/router/router", () => ({ ROUTES: {} }));
jest.mock("@/utils/addressBook", () => ({}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: {},
  AVAILABLE_NETWORKS: [],
  isAvailableNetwork: () => false,
}));
jest.mock("@/stores/store", () => ({ store: {} }));
jest.mock("@/utils/mobileConnect/mobileConnection", () => ({}));
jest.mock("@/services/dappConnect/accountBinding", () => ({}));

let receive: (message: NativeMessage) => void;
let dispose: (() => void) | undefined;

const appState = (state: string): void =>
  receive({ type: "APP_STATE", payload: { state } });

beforeEach(() => {
  jest.mocked(subscribeToNativeMessages).mockImplementation((listener) => {
    receive = listener;
    return () => undefined;
  });
  jest.mocked(useEffect).mockImplementation((effect) => {
    dispose = effect() as (() => void) | undefined;
  });
  NativeAppBridge({});
  setNativeInjectedPin("123456");
});

afterEach(() => {
  dispose?.();
  setNativeInjectedPin("");
  jest.clearAllMocks();
});

describe("injected Device Login PIN lifetime with APP_LOCKED support", () => {
  beforeEach(() => {
    mockCapabilities = { appLockedSignal: true };
  });

  it("survives the inactive/active pair around a Face ID prompt", () => {
    appState("inactive");
    appState("active");
    expect(getNativeInjectedPin()).toBe("123456");
  });

  it("is cleared when the app goes to the background", () => {
    appState("background");
    expect(getNativeInjectedPin()).toBeNull();
  });

  it("is cleared by an APP_LOCKED signal that comes without a background", () => {
    appState("inactive");
    receive({ type: "APP_LOCKED", payload: {} });
    expect(getNativeInjectedPin()).toBeNull();
    appState("active");
    expect(getNativeInjectedPin()).toBeNull();
  });
});

describe("injected Device Login PIN lifetime without APP_LOCKED support", () => {
  beforeEach(() => {
    mockCapabilities = { platform: "ios" };
  });

  it.each(["inactive", "active", "background"])(
    "is cleared on every APP_STATE (%s), as before",
    (state) => {
      appState(state);
      expect(getNativeInjectedPin()).toBeNull();
    },
  );
});
