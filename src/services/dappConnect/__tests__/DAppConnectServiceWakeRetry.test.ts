/**
 * @jest-environment jsdom
 *
 * Retrying sessions the relay refused, without waiting for a reload.
 *
 * A session kept after `onReconnectAbandoned` has no live socket and nothing
 * scheduled. Coming back online and returning to the tab are the two moments
 * the refusal is most likely over, so both retry, rate limited.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { TextDecoder, TextEncoder } from "node:util";
import { SessionStatus, type DAppSession } from "../types";

// jsdom ships neither, and the PQ crypto module builds its labels at import.
const encoders: Partial<Pick<typeof globalThis, "TextEncoder" | "TextDecoder">> =
  globalThis;
Object.assign(globalThis, {
  TextEncoder: encoders.TextEncoder ?? TextEncoder,
  TextDecoder: encoders.TextDecoder ?? TextDecoder,
});

jest.mock("../SocketClient", () => ({
  SocketNotConnectedError: class extends Error {},
  SocketClient: class {
    isConnected(): boolean {
      return false;
    }
    willReconnect(): boolean {
      return false;
    }
    disconnect(): void {
      /* no socket was opened */
    }
  },
}));

jest.mock("@/stores/store", () => ({ store: { qrlStore: {} } }));

jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => false,
  parseExternalHttpUrl: () => null,
  sendToNative: () => undefined,
  logToNative: () => undefined,
}));

type ServiceModule = typeof import("../DAppConnectService");
type StoreModule = typeof import("../SessionStore");

// Imported after the polyfills above, because the PQ crypto module reads
// TextEncoder while it is being evaluated.
let DAppConnectService: ServiceModule["DAppConnectService"];
let SessionStore: StoreModule["SessionStore"];

beforeAll(async () => {
  const module = await import("../DAppConnectService");
  DAppConnectService = module.DAppConnectService;
  ({ SessionStore } = await import("../SessionStore"));
  // The module builds the app's singleton as it loads, and that instance
  // binds these same listeners. Silence it so only the service under test
  // reacts here.
  module.dappConnectService.dispose();
});

const CHANNEL = "00000000-0000-0000-0000-000000000000";

let service: InstanceType<ServiceModule["DAppConnectService"]>;
let reconnectAll: jest.SpiedFunction<
  ServiceModule["DAppConnectService"]["prototype"]["reconnectAll"]
>;
let visibility: "visible" | "hidden" = "visible";

const wake = (event: "online" | "visibilitychange"): void => {
  if (event === "online") {
    window.dispatchEvent(new Event("online"));
    return;
  }
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  // One stored session with no live connection: exactly the state a relay
  // refusal leaves behind.
  const session: DAppSession = {
    version: 4,
    id: CHANNEL,
    dappInfo: { name: "Wake retry", url: "https://dapp.example/", chainId: "0x1" },
    originatorInfoReceived: true,
    accountAuthorized: false,
    connectedAccount: "",
    keyExchange: {
      protocolVersion: 3,
      cid: "AAAAAAAAAAAAAAAAAAAAAA==",
      kAeadRaw: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      htx: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      sendDir: "AAAAAg==",
      recvDir: "AAAAAQ==",
      sendSeq: 1,
      recvSeq: 1,
    },
    relayUrl: "https://relay.example",
    status: SessionStatus.DISCONNECTED,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  jest.spyOn(SessionStore, "getAll").mockReturnValue([session]);
  service = new DAppConnectService();
  reconnectAll = jest
    .spyOn(service, "reconnectAll")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  service.dispose();
  jest.restoreAllMocks();
});

describe("wake retry", () => {
  it("retries when the machine comes back online", () => {
    wake("online");
    expect(reconnectAll).toHaveBeenCalledTimes(1);
  });

  it("retries when the tab becomes visible again", () => {
    wake("visibilitychange");
    expect(reconnectAll).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the tab is hidden", () => {
    visibility = "hidden";
    wake("visibilitychange");
    wake("online");
    expect(reconnectAll).not.toHaveBeenCalled();
  });

  it("rate limits a burst of wake events", () => {
    wake("online");
    wake("visibilitychange");
    wake("online");
    expect(reconnectAll).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while every stored session is live", () => {
    jest.spyOn(service["connections"], "has").mockImplementation((id) => id === CHANNEL);

    wake("online");
    expect(reconnectAll).not.toHaveBeenCalled();
  });

  it("stops listening once disposed", () => {
    service.dispose();
    wake("online");
    expect(reconnectAll).not.toHaveBeenCalled();
  });
});
