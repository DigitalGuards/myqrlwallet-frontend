import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { RelayMessage } from "../types";

const mockQrlAccount = `Q${"0".repeat(128)}`;
const mockQrlRecipient = `Q${"1".repeat(128)}`;
const mockQrlOther = `Q${"2".repeat(128)}`;

interface MockSocketHandlers {
  onMessage: (data: RelayMessage) => void;
  onConnected: () => void;
  onDisconnected: (reason: string) => void;
  onReconnected: () => void;
  /** The relay disconnected this socket and it will not come back. */
  onReconnectAbandoned?: () => void;
  onParticipantsChanged: (data: { event: string; clientType?: string }) => void;
  onTerminated?: () => void;
}

interface MockJoinResult {
  bufferedMessages: unknown[];
  channelPublicKey: string | null;
  terminated: boolean;
}

interface MockSocketInstance {
  relayUrl: string;
  /** Mirrors SocketClient.willReconnect; false models a relay that gave up. */
  canReconnect: boolean;
  /** Mirrors SocketClient.isJoined; false models a socket outside the channel. */
  joined: boolean;
  handlers: MockSocketHandlers;
  sent: RelayMessage[];
  /** Mirrors SocketClient.isConnected, which the service checks before sealing. */
  connected: boolean;
  connectCalls: number;
  joinCalls: string[];
  leaveCalls: number;
  closeCalls: number;
  disconnectCalls: number;
}

const mockSocketClientInstances: MockSocketInstance[] = [];

/** The ciphertext a relay frame carries, for the tests that decrypt one. */
function relayCiphertext(frame: RelayMessage | undefined): string {
  const message = frame?.message;
  if (typeof message !== "string") {
    throw new Error("expected an encrypted relay frame");
  }
  return message;
}
let mockJoinResult: MockJoinResult = {
  bufferedMessages: [],
  channelPublicKey: null,
  terminated: false,
};
let mockBeforeSendHook: (() => Promise<void>) | null = null;
/** The relay answers the frame with a pre-delivery refusal. */
let mockRelayRefusesFrame = false;
let mockSendHook: ((data: RelayMessage) => Promise<void>) | null = null;
let mockLeaveHook: (() => Promise<boolean>) | null = null;
let mockCloseHook: (() => Promise<boolean>) | null = null;

// The whole module is replaced, so the error class is declared inside the
// factory: the service imports it from this mock, which is what makes its
// instanceof check meaningful in these tests.
jest.mock("../SocketClient", () => {
  class MockSocketNotConnectedError extends Error {
    constructor(message = "Socket not connected") {
      super(message);
      this.name = "SocketNotConnectedError";
    }
  }
  // A subclass in the real module too, so the service's single instanceof
  // check covers both and a membership refusal is held rather than tombstoned.
  class MockRelayChannelNotJoinedError extends MockSocketNotConnectedError {
    constructor(message = "Relay channel not joined") {
      super(message);
      this.name = "RelayChannelNotJoinedError";
    }
  }
  return {
  SocketNotConnectedError: MockSocketNotConnectedError,
  RelayChannelNotJoinedError: MockRelayChannelNotJoinedError,
  SocketClient: class {
    relayUrl: string;
    handlers: MockSocketHandlers;
    sent: RelayMessage[] = [];
    connectCalls = 0;
    joinCalls: string[] = [];
    leaveCalls = 0;
    closeCalls = 0;
    disconnectCalls = 0;

    constructor(relayUrl: string, handlers: MockSocketHandlers) {
      this.relayUrl = relayUrl;
      this.handlers = handlers;
      mockSocketClientInstances.push(this);
    }

    /**
     * Mirrors SocketClient.isConnected. The service checks reachability
     * before sealing a message, so the double has to model it; tests that
     * exercise the offline path flip this.
     */
    connected = true;

    isConnected(): boolean {
      return this.connected;
    }

    /**
     * Mirrors SocketClient.isJoined. Socket-level connectedness is not channel
     * membership, and the service seals against membership: the relay refuses a
     * frame from a non-member. Tests that model the rejoin window flip this.
     */
    joined = true;

    isJoined(): boolean {
      return this.connected && this.joined;
    }

    /**
     * Mirrors SocketClient.willReconnect. Tests that model a relay which has
     * given up for good set this to false.
     */
    canReconnect = true;

    willReconnect(): boolean {
      return (this.connected && this.joined) || this.canReconnect;
    }

    async connect(): Promise<void> {
      this.connectCalls++;
      this.connected = true;
    }

    async joinChannel(channelId: string): Promise<MockJoinResult> {
      this.joinCalls.push(channelId);
      this.joined = !mockJoinResult.terminated;
      return {
        ...mockJoinResult,
        bufferedMessages: [...mockJoinResult.bufferedMessages],
      };
    }

    async sendMessage(data: RelayMessage): Promise<void> {
      // Runs before the connectivity check, so a test can model the socket
      // dying between the checkpoint and the send: nothing is emitted and
      // nothing is recorded as sent.
      if (mockBeforeSendHook) await mockBeforeSendHook();
      // The relay's own view refuses the frame before delivering or buffering
      // it. The real client turns that acknowledgement into this typed error
      // and drops its membership claim.
      if (mockRelayRefusesFrame) {
        this.joined = false;
        throw new MockRelayChannelNotJoinedError("Sender not in channel");
      }
      // Mirrors the real client: a socket known to be down rejects before
      // anything is emitted, and nothing is recorded as sent. Without this
      // neither the old fail-closed behaviour nor a drop between the
      // checkpoint and the send could be reproduced here.
      if (!this.connected) throw new MockSocketNotConnectedError();
      this.sent.push(data);
      if (mockSendHook) await mockSendHook(data);
    }

    async leaveChannel(): Promise<boolean> {
      this.leaveCalls++;
      if (mockLeaveHook) return mockLeaveHook();
      return true;
    }

    async closeChannel(): Promise<boolean> {
      this.closeCalls++;
      if (mockCloseHook) return mockCloseHook();
      return true;
    }

    disconnect(): void {
      this.disconnectCalls++;
      this.connected = false;
    }
  },
  };
});

jest.mock("@/stores/store", () => ({
  store: {
    qrlStore: {
      activeAccount: {
        accountAddress: `Q${"0".repeat(128)}`,
      },
      qrlInstance: {
        currentProvider: {
          request: jest.fn(async ({ method }: { method: string }) => {
            if (method === "qrl_chainId") return "0x539";
            throw new Error(`Unexpected RPC method: ${method}`);
          }),
        },
      },
    },
  },
}));

/** Flipped by the tests that model the wallet running inside the native app. */
let mockInNativeApp = false;
/** Every bridge message the service sent, in order. */
const mockNativeMessages: Array<{
  type: string;
  payload?: Record<string, unknown>;
}> = [];

jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => mockInNativeApp,
  parseExternalHttpUrl: (value: string) => {
    try {
      const parsed = new URL(value);
      const loopback =
        parsed.hostname === "localhost" ||
        parsed.hostname.endsWith(".localhost") ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]";
      return (parsed.protocol === "https:" ||
        (parsed.protocol === "http:" && loopback)) &&
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.hostname !== ""
        ? parsed.toString()
        : null;
    } catch {
      return null;
    }
  },
  sendToNative: (type: string, payload?: Record<string, unknown>) => {
    mockNativeMessages.push({ type, payload });
    return true;
  },
  triggerHaptic: () => undefined,
  logToNative: () => false,
}));

import { DAppConnectService } from "../DAppConnectService";
import { PENDING_DAPP_INFO } from "../dappMetadata";
import { KeyExchange, type Session } from "../KeyExchange";
import {
  DIR_DAPP_TX,
  DIR_WALLET_TX,
  importRawAeadKey,
  kemKeygen,
  toBase64,
  zeroize,
} from "../PQCrypto";
import { base45Encode } from "../base45";
import { cidToString, computeFingerprint } from "../qrUri";
import { SessionStore } from "../SessionStore";
import {
  MessageType,
  type DAppSession,
  type PendingDAppRequest,
  SessionStatus,
} from "../types";
import { advanceWalletEpoch } from "@/utils/walletEpoch";
import { store as mockedStore } from "@/stores/store";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  failNextWrite: Error | null = null;
  failWrites: Error | null = null;

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw this.failWrites;
    const failure = this.failNextWrite;
    this.failNextWrite = null;
    if (failure) throw failure;
    this.values.set(key, value);
  }
}

interface FakeLock {
  name: string;
  mode: "exclusive";
}

class FakeLockManager {
  private readonly held = new Set<string>();

  request(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: FakeLock | null) => void | Promise<void>,
  ): Promise<void> {
    if (!options.ifAvailable)
      throw new Error("Tests require ifAvailable locks");
    if (this.held.has(name)) {
      return Promise.resolve(callback(null)).then(() => undefined);
    }
    this.held.add(name);
    return Promise.resolve(callback({ name, mode: "exclusive" })).finally(
      () => {
        this.held.delete(name);
      },
    );
  }
}

interface Pairing {
  session: DAppSession;
  dapp: KeyExchange;
}

interface ServiceHandlers {
  pending: PendingDAppRequest[];
  checkpointAtDispatch: number[];
  /** Channels the service told the UI to close its approvals for. */
  disconnected: string[];
  /** Channels whose answer reached the dApp and asked for a hand-back. */
  handedBack: string[];
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);
let storage = new MemoryStorage();
let services: DAppConnectService[] = [];
let logSpy: ReturnType<typeof jest.spyOn> | null = null;
let errorSpy: ReturnType<typeof jest.spyOn> | null = null;

async function makePairing(
  _channelLabel = "security-service-channel",
): Promise<Pairing> {
  const rawKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const key = await importRawAeadKey(rawKey);
  const cid = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const htx = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const walletSession: Session = {
    cid,
    key,
    htx,
    sendDir: DIR_WALLET_TX,
    recvDir: DIR_DAPP_TX,
    sendSeq: 1,
    recvSeq: 1,
  };
  const dappSession: Session = {
    cid,
    key,
    htx,
    sendDir: DIR_DAPP_TX,
    recvDir: DIR_WALLET_TX,
    sendSeq: 1,
    recvSeq: 1,
  };
  const wallet = new KeyExchange(walletSession);
  const channelId = cidToString(cid);
  const keyExchange = await wallet.exportPersisted();
  if (!keyExchange) throw new Error("Expected wallet persistence material");
  return {
    dapp: new KeyExchange(dappSession),
    session: {
      version: 4,
      id: channelId,
      dappInfo: {
        name: "Security test dApp",
        url: "https://dapp.example/",
        chainId: "0x1",
      },
      originatorInfoReceived: true,
      accountAuthorized: true,
      connectedAccount: mockQrlAccount,
      keyExchange,
      relayUrl: "https://relay.example",
      status: SessionStatus.CONNECTED,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    },
  };
}

function firstSocket(): MockSocketInstance {
  const socket = mockSocketClientInstances[0];
  if (!socket) throw new Error("Expected a SocketClient instance");
  return socket;
}

/**
 * Let every queued microtask and timer callback run.
 *
 * `waitFor(() => true)` returns immediately and waits for nothing, so a test
 * that used it to "let the service settle" asserted against state the service
 * had not reached yet.
 */
async function settle(turns = 20): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const errors =
    errorSpy?.mock.calls
      .map((call: unknown[]) =>
        call.map((value: unknown) => String(value)).join(" "),
      )
      .join(" | ") ?? "";
  throw new Error(
    `Timed out waiting for asynchronous service work${errors ? `: ${errors}` : ""}`,
  );
}

async function makeConnectionUri(): Promise<{
  channelId: string;
  uri: string;
  publicKey: string;
  cid: Uint8Array;
  pk: Uint8Array;
  cap: Uint8Array;
}> {
  const cid = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const { pk, sk } = kemKeygen();
  const cap = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const fingerprint = await computeFingerprint(cid, pk, cap);
  const blob = new Uint8Array(4 + cid.length + fingerprint.length + cap.length);
  blob.set([0x50, 0x51, 0x50, 0x33], 0);
  blob.set(cid, 4);
  blob.set(fingerprint, 4 + cid.length);
  blob.set(cap, 4 + cid.length + fingerprint.length);
  zeroize(sk);
  return {
    channelId: cidToString(cid),
    uri: `qrlconnect://?${new URLSearchParams({ q: base45Encode(blob) }).toString()}`,
    publicKey: toBase64(pk),
    cid,
    pk,
    cap,
  };
}

async function makeConnectionUriForPublicKey(
  cid: Uint8Array,
  pk: Uint8Array,
  cap: Uint8Array,
): Promise<string> {
  const fingerprint = await computeFingerprint(cid, pk, cap);
  const blob = new Uint8Array(4 + cid.length + fingerprint.length + cap.length);
  blob.set([0x50, 0x51, 0x50, 0x33], 0);
  blob.set(cid, 4);
  blob.set(fingerprint, 4 + cid.length);
  blob.set(cap, 4 + cid.length + fingerprint.length);
  return `qrlconnect://?${new URLSearchParams({ q: base45Encode(blob) }).toString()}`;
}

async function reconnect(
  session: DAppSession,
): Promise<{ service: DAppConnectService; observed: ServiceHandlers }> {
  SessionStore.save(session);
  const observed: ServiceHandlers = {
    pending: [],
    checkpointAtDispatch: [],
    disconnected: [],
    handedBack: [],
  };
  const service = new DAppConnectService();
  services.push(service);
  service.setHandlers({
    onSessionsChanged: () => undefined,
    onPendingRequest: (request) => {
      observed.pending.push(request);
      const checkpoint = SessionStore.get(request.sessionId);
      observed.checkpointAtDispatch.push(checkpoint?.keyExchange.recvSeq ?? -1);
    },
    onSessionConnected: () => undefined,
    onSessionDisconnected: (sessionId) => {
      observed.disconnected.push(sessionId);
    },
    onReturnHandedBack: (sessionId) => {
      observed.handedBack.push(sessionId);
    },
  });
  await service.reconnectAll();
  return { service, observed };
}

async function deliverEncrypted(
  pairing: Pairing,
  socket: MockSocketInstance,
  message: Record<string, unknown>,
): Promise<void> {
  const ciphertext = await pairing.dapp.encryptMessage(JSON.stringify(message));
  socket.handlers.onMessage({
    id: pairing.session.id,
    clientType: "dapp",
    message: ciphertext,
  });
}

async function decryptWalletFrame(
  pairing: Pairing,
  frame: RelayMessage | undefined,
): Promise<Record<string, unknown>> {
  if (typeof frame?.message !== "string") {
    throw new Error("Expected an encrypted wallet frame");
  }
  return JSON.parse(await pairing.dapp.decryptMessage(frame.message)) as Record<
    string,
    unknown
  >;
}

function approveTracked(
  service: DAppConnectService,
  sessionId: string,
  requestId: string | number,
  result: unknown,
): void {
  const internals = Object(service) as {
    pendingRestrictedMethods: Map<
      string,
      Map<string, { method: string; authorizedAccount: string | null }>
    >;
  };
  let requests = internals.pendingRestrictedMethods.get(sessionId);
  if (!requests) {
    requests = new Map();
    internals.pendingRestrictedMethods.set(sessionId, requests);
  }
  requests.set(`${typeof requestId}:${String(requestId)}`, {
    method: "wallet_switchQrlChain",
    authorizedAccount: null,
  });
  service.approveRequest(sessionId, requestId, result);
}

beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { locks: new FakeLockManager() },
  });
  services = [];
  mockSocketClientInstances.length = 0;
  mockJoinResult = {
    bufferedMessages: [],
    channelPublicKey: null,
    terminated: false,
  };
  mockSendHook = null;
  mockBeforeSendHook = null;
  mockRelayRefusesFrame = false;
  mockInNativeApp = false;
  mockNativeMessages.length = 0;
  mockLeaveHook = null;
  mockCloseHook = null;
  (
    Object(mockedStore.qrlStore.activeAccount) as {
      accountAddress: string;
    }
  ).accountAddress = mockQrlAccount;
  logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  mockSendHook = null;
  mockRelayRefusesFrame = false;
  mockLeaveHook = null;
  mockCloseHook = null;
  await Promise.all(services.map((service) => service.disconnectAll()));
  services.forEach((service) => service.dispose());
  logSpy?.mockRestore();
  errorSpy?.mockRestore();
});

afterAll(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, "navigator");
  }
});

describe("wallet service AEAD checkpointing", () => {
  it("preserves the fresh QR connect flow while acquiring exclusive ownership", async () => {
    const connection = await makeConnectionUri();
    mockJoinResult.channelPublicKey = connection.publicKey;
    const service = new DAppConnectService();
    services.push(service);

    await expect(service.handleConnectionURI(connection.uri)).resolves.toEqual({
      success: true,
    });

    const socket = firstSocket();
    expect(socket.connectCalls).toBe(1);
    expect(socket.joinCalls).toEqual([connection.channelId]);
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).toMatchObject({
      id: connection.channelId,
      clientType: "wallet",
      message: { type: "key_handshake_SYNACK", v: 3 },
    });
    expect(JSON.stringify(socket.sent[0])).not.toContain(
      toBase64(connection.cap),
    );
  });

  it("rejects a duplicate cid carrying an attacker-chosen cap and matching fp", async () => {
    const connection = await makeConnectionUri();
    mockJoinResult.channelPublicKey = connection.publicKey;
    const service = new DAppConnectService();
    services.push(service);

    await expect(service.handleConnectionURI(connection.uri)).resolves.toEqual({
      success: true,
    });

    const attackerCap = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const attackerUri = await makeConnectionUriForPublicKey(
      connection.cid,
      connection.pk,
      attackerCap,
    );
    await expect(service.handleConnectionURI(attackerUri)).resolves.toEqual({
      success: false,
      error:
        "Scanned QR does not match the already-connected dApp for this channel",
    });

    expect(mockSocketClientInstances).toHaveLength(1);
  });

  it("single-flights concurrent scans of the same PQP3 URI", async () => {
    const connection = await makeConnectionUri();
    mockJoinResult.channelPublicKey = connection.publicKey;
    const service = new DAppConnectService();
    services.push(service);

    await expect(
      Promise.all([
        service.handleConnectionURI(connection.uri),
        service.handleConnectionURI(connection.uri),
      ]),
    ).resolves.toEqual([{ success: true }, { success: true }]);

    expect(mockSocketClientInstances).toHaveLength(1);
    expect(firstSocket().joinCalls).toEqual([connection.channelId]);
    expect(firstSocket().sent).toHaveLength(1);
  });

  it("rejects a malformed relay public key before ML-KEM encapsulation", async () => {
    const connection = await makeConnectionUri();
    mockJoinResult.channelPublicKey = "A".repeat(1580);
    const service = new DAppConnectService();
    services.push(service);

    await expect(service.handleConnectionURI(connection.uri)).resolves.toEqual({
      success: false,
      error: "Relay returned an invalid ML-KEM public key",
    });
    expect(firstSocket().sent).toHaveLength(0);
  });

  it("rejects an oversized or cross-channel relay buffer before processing", async () => {
    const connection = await makeConnectionUri();
    mockJoinResult.channelPublicKey = connection.publicKey;
    mockJoinResult.bufferedMessages = Array.from({ length: 51 }, () => ({
      id: connection.channelId,
      clientType: "dapp",
      message: "ciphertext",
    }));
    const service = new DAppConnectService();
    services.push(service);

    await expect(service.handleConnectionURI(connection.uri)).resolves.toEqual({
      success: false,
      error: "Relay returned an invalid buffered message list",
    });

    mockJoinResult.bufferedMessages = [
      { id: "another-channel", clientType: "dapp", message: "ciphertext" },
    ];
    await expect(service.handleConnectionURI(connection.uri)).resolves.toEqual({
      success: false,
      error: "Relay returned a malformed buffered message",
    });
  });

  it("tears down a fresh channel when the relay delivers a pre-v3 ACK", async () => {
    const connection = await makeConnectionUri();
    mockJoinResult.channelPublicKey = connection.publicKey;
    const service = new DAppConnectService();
    services.push(service);
    await expect(service.handleConnectionURI(connection.uri)).resolves.toEqual({
      success: true,
    });
    const socket = firstSocket();

    socket.handlers.onMessage({
      id: connection.channelId,
      clientType: "dapp",
      message: {
        type: "key_handshake_ACK",
        c1: "AA==",
        v: 2,
      },
    });

    await waitFor(() => socket.disconnectCalls === 1);
    expect(socket.leaveCalls).toBe(1);
    expect(socket.closeCalls).toBe(0);
  });

  it("persists recvSeq before plaintext dispatch and closes the replay window", async () => {
    const pairing = await makePairing();
    const { service, observed } = await reconnect(pairing.session);
    const socket = firstSocket();
    const ciphertext = await pairing.dapp.encryptMessage(
      JSON.stringify({
        type: MessageType.JSONRPC,
        jsonrpc: "2.0",
        id: 7,
        method: "qrl_signMessage",
        params: [mockQrlAccount, "0x01"],
      }),
    );

    socket.handlers.onMessage({
      id: pairing.session.id,
      clientType: "dapp",
      message: ciphertext,
    });
    await waitFor(() => observed.pending.length === 1);

    expect(observed.checkpointAtDispatch).toEqual([2]);
    const checkpoint = SessionStore.get(pairing.session.id);
    if (!checkpoint) throw new Error("Expected persisted receive checkpoint");
    const restored = new KeyExchange(
      await KeyExchange.sessionFromPersisted(checkpoint.keyExchange),
    );
    await expect(restored.decryptMessage(ciphertext)).rejects.toThrow();

    await service.disconnectSession(pairing.session.id);
  });

  it("drops cross-channel and self-role live frames before AEAD accounting", async () => {
    const pairing = await makePairing();
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    const before = SessionStore.get(pairing.session.id)?.keyExchange.recvSeq;

    socket.handlers.onMessage({
      id: "another-channel",
      clientType: "dapp",
      message: "not-ciphertext",
    });
    socket.handlers.onMessage({
      id: pairing.session.id,
      clientType: "wallet",
      message: "not-ciphertext",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(SessionStore.get(pairing.session.id)?.keyExchange.recvSeq).toBe(
      before,
    );
    expect(socket.disconnectCalls).toBe(0);
    await service.disconnectSession(pairing.session.id);
  });

  it("serializes concurrent responses and checkpoints sendSeq before relay send", async () => {
    const pairing = await makePairing();
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    const checkpoints: number[] = [];
    mockSendHook = async () => {
      const stored = SessionStore.get(pairing.session.id);
      checkpoints.push(stored?.keyExchange.sendSeq ?? -1);
    };

    approveTracked(service, pairing.session.id, 1, "first");
    approveTracked(service, pairing.session.id, 2, "second");
    await waitFor(() => socket.sent.length === 2);

    expect(checkpoints).toEqual([2, 3]);
    const plaintexts: string[] = [];
    for (const relayMessage of socket.sent) {
      if (typeof relayMessage.message !== "string") {
        throw new Error("Expected encrypted relay message");
      }
      plaintexts.push(await pairing.dapp.decryptMessage(relayMessage.message));
    }
    expect(plaintexts.map((value) => JSON.parse(value))).toMatchObject([
      { type: MessageType.JSONRPC, id: 1, result: "first" },
      { type: MessageType.JSONRPC, id: 2, result: "second" },
    ]);
  });

  it("keeps simultaneous inbound and outbound checkpoints monotonic", async () => {
    const pairing = await makePairing();
    const { service, observed } = await reconnect(pairing.session);
    const socket = firstSocket();
    const checkpoints: Array<{ sendSeq: number; recvSeq: number }> = [];
    const originalSave = SessionStore.save.bind(SessionStore);
    const saveSpy = jest
      .spyOn(SessionStore, "save")
      .mockImplementation((session) => {
        checkpoints.push({
          sendSeq: session.keyExchange.sendSeq,
          recvSeq: session.keyExchange.recvSeq,
        });
        originalSave(session);
      });

    try {
      const ciphertext = await pairing.dapp.encryptMessage(
        JSON.stringify({
          type: MessageType.JSONRPC,
          jsonrpc: "2.0",
          id: 91,
          method: "qrl_signMessage",
          params: [mockQrlAccount, "0x01"],
        }),
      );
      approveTracked(service, pairing.session.id, 90, "outbound");
      socket.handlers.onMessage({
        id: pairing.session.id,
        clientType: "dapp",
        message: ciphertext,
      });
      await waitFor(
        () => socket.sent.length === 1 && observed.pending.length === 1,
      );

      const final = SessionStore.get(pairing.session.id);
      expect(final?.keyExchange).toMatchObject({ sendSeq: 2, recvSeq: 2 });
      expect(checkpoints.length).toBeGreaterThanOrEqual(2);
      for (let index = 1; index < checkpoints.length; index++) {
        const previous = checkpoints[index - 1];
        const current = checkpoints[index];
        if (!previous || !current)
          throw new Error("Expected adjacent checkpoints");
        expect(current.sendSeq).toBeGreaterThanOrEqual(previous.sendSeq);
        expect(current.recvSeq).toBeGreaterThanOrEqual(previous.recvSeq);
      }
    } finally {
      saveSpy.mockRestore();
    }
  });

  it("puts encrypted TERMINATE behind prior sends on the same queue", async () => {
    const pairing = await makePairing();
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();

    approveTracked(service, pairing.session.id, 1, "approved");
    await service.disconnectSession(pairing.session.id);

    expect(socket.sent).toHaveLength(2);
    const decrypted: Array<Record<string, unknown>> = [];
    for (const relayMessage of socket.sent) {
      if (typeof relayMessage.message !== "string") {
        throw new Error("Expected encrypted relay message");
      }
      decrypted.push(
        JSON.parse(await pairing.dapp.decryptMessage(relayMessage.message)),
      );
    }
    expect(decrypted[0]).toMatchObject({ type: MessageType.JSONRPC, id: 1 });
    expect(decrypted[1]).toEqual({ type: MessageType.TERMINATE });
  });

  it("makes a racing explicit disconnect await and upgrade the shared teardown", async () => {
    const pairing = await makePairing();
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    let releaseSend: () => void = () => undefined;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    mockSendHook = () => sendGate;

    const remoteTeardown = service.disconnectSession(pairing.session.id, false);
    await waitFor(() => socket.sent.length === 1);
    let explicitResolved = false;
    const explicitTeardown = service
      .disconnectSession(pairing.session.id, true)
      .then(() => {
        explicitResolved = true;
      });
    await Promise.resolve();
    expect(explicitResolved).toBe(false);

    releaseSend();
    await Promise.all([remoteTeardown, explicitTeardown]);

    expect(explicitResolved).toBe(true);
    expect(socket.closeCalls).toBe(1);
    expect(socket.leaveCalls).toBe(0);
    expect(SessionStore.get(pairing.session.id)).toBeNull();
  });

  it("upgrades a transient leave to a durable close while its acknowledgement is pending", async () => {
    const pairing = await makePairing("leave-upgrade-race");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    let releaseLeave: () => void = () => undefined;
    const leaveGate = new Promise<void>((resolve) => {
      releaseLeave = resolve;
    });
    mockLeaveHook = async () => {
      await leaveGate;
      return true;
    };

    const transient = service.disconnectSession(pairing.session.id, false);
    await waitFor(() => socket.leaveCalls === 1);
    const durable = service.disconnectSession(pairing.session.id, true);
    releaseLeave();

    await expect(Promise.all([transient, durable])).resolves.toEqual([
      true,
      true,
    ]);
    expect(socket.closeCalls).toBe(1);
    expect(SessionStore.get(pairing.session.id)).toBeNull();
  });

  it("joins and tombstones a cold persisted session before forgetting it", async () => {
    const pairing = await makePairing("cold-tombstone");
    SessionStore.save(pairing.session);
    const service = new DAppConnectService();
    services.push(service);

    await expect(service.disconnectSession(pairing.session.id)).resolves.toBe(
      true,
    );

    const socket = firstSocket();
    expect(socket.connectCalls).toBe(1);
    expect(socket.joinCalls).toEqual([pairing.session.id]);
    expect(socket.closeCalls).toBe(1);
    expect(socket.disconnectCalls).toBe(1);
    expect(SessionStore.get(pairing.session.id)).toBeNull();
  });

  it("tells the native app when a cold persisted session is disconnected", async () => {
    // The banner's Disconnect on an offline or reconnecting pairing takes
    // this path. Without the message the app's dApp list kept showing the
    // pairing as connected.
    const pairing = await makePairing("cold-native-notify");
    SessionStore.save(pairing.session);
    const service = new DAppConnectService();
    services.push(service);
    mockInNativeApp = true;

    await expect(service.disconnectSession(pairing.session.id)).resolves.toBe(
      true,
    );

    expect(
      mockNativeMessages.filter((message) => message.type === "DAPP_DISCONNECTED"),
    ).toEqual([
      {
        type: "DAPP_DISCONNECTED",
        payload: { channelId: pairing.session.id, explicit: true },
      },
    ]);
  });

  it("completes a user disconnect when the dApp closes the channel first", async () => {
    // The user's Disconnect sends TERMINATE; the dApp answers with its own
    // close_channel, and the relay then refuses ours. The channel is dead and
    // tombstoned, so the session must go and the native app must be told.
    const pairing = await makePairing("dapp-closes-first");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    mockInNativeApp = true;
    mockCloseHook = async () => {
      socket.handlers.onParticipantsChanged({ event: "close", clientType: "dapp" });
      return false;
    };

    await expect(service.disconnectSession(pairing.session.id, true)).resolves.toBe(
      true,
    );
    await settle();

    expect(SessionStore.get(pairing.session.id)).toBeNull();
    expect(
      mockNativeMessages.filter((message) => message.type === "DAPP_DISCONNECTED"),
    ).toEqual([
      {
        type: "DAPP_DISCONNECTED",
        payload: { channelId: pairing.session.id, explicit: true },
      },
    ]);
  });

  it("keeps a session retryable when a durable close is not acknowledged", async () => {
    const pairing = await makePairing("lost-close-ack");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    mockCloseHook = async () => false;

    await expect(service.disconnectSession(pairing.session.id)).resolves.toBe(
      false,
    );

    expect(socket.closeCalls).toBe(1);
    expect(socket.disconnectCalls).toBe(1);
    expect(SessionStore.get(pairing.session.id)).toMatchObject({
      id: pairing.session.id,
      status: SessionStatus.CONNECTED,
    });

    mockCloseHook = null;
    await expect(service.disconnectSession(pairing.session.id)).resolves.toBe(
      true,
    );
    expect(mockSocketClientInstances).toHaveLength(2);
    expect(SessionStore.get(pairing.session.id)).toBeNull();
  });

  it("does not send or dispatch when its counter checkpoint cannot be persisted", async () => {
    const outbound = await makePairing("outbound-persist-failure");
    const outboundConnection = await reconnect(outbound.session);
    const outboundSocket = firstSocket();
    storage.failNextWrite = new Error("quota denied");

    approveTracked(outboundConnection.service, outbound.session.id, 1, "unsafe");
    await waitFor(() => outboundSocket.closeCalls === 1);

    expect(outboundSocket.sent).toHaveLength(0);
    expect(outboundSocket.disconnectCalls).toBe(1);
    expect(SessionStore.get(outbound.session.id)).toBeNull();

    const inbound = await makePairing("inbound-persist-failure");
    const inboundConnection = await reconnect(inbound.session);
    const inboundSocket = mockSocketClientInstances[1];
    if (!inboundSocket)
      throw new Error("Expected second SocketClient instance");
    const ciphertext = await inbound.dapp.encryptMessage(
      JSON.stringify({
        type: MessageType.JSONRPC,
        id: 2,
        method: "qrl_signMessage",
        params: [mockQrlAccount, "0x01"],
      }),
    );
    storage.failNextWrite = new Error("quota denied");
    inboundSocket.handlers.onMessage({
      id: inbound.session.id,
      clientType: "dapp",
      message: ciphertext,
    });
    await waitFor(() => inboundSocket.closeCalls === 1);

    expect(inboundConnection.observed.pending).toHaveLength(0);
    expect(inboundSocket.disconnectCalls).toBe(1);
  });

  it("holds an answer when the relay is unreachable and delivers it on reconnect", async () => {
    // The moment a transaction answer is due is exactly the moment the wallet
    // is backgrounding: the user approved and switched back to the dApp. A
    // send with no socket used to reach SocketClient.sendMessage, reject with
    // "Socket not connected", and be treated as an ambiguous relay outcome,
    // which tombstoned the pairing. Nothing was emitted and no counter was
    // spent, so it can simply wait.
    const pairing = await makePairing("offline-answer");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    socket.connected = false;

    approveTracked(service, pairing.session.id, 1, "0xhash");
    await settle();

    expect(socket.sent).toHaveLength(0);
    // The session survives: no tombstone, no teardown.
    expect(socket.closeCalls).toBe(0);
    expect(socket.disconnectCalls).toBe(0);
    expect(SessionStore.get(pairing.session.id)).not.toBeNull();

    socket.connected = true;
    socket.handlers.onReconnected?.();
    await waitFor(() => socket.sent.length === 1);

    const delivered = JSON.parse(
      await pairing.dapp.decryptMessage(relayCiphertext(socket.sent[0])),
    ) as Record<string, unknown>;
    expect(delivered["id"]).toBe(1);
    expect(delivered["result"]).toBe("0xhash");
  });

  it("keeps the counter contiguous across a held answer", async () => {
    // Sealing consumes a send counter and checkpoints it before the
    // ciphertext leaves. A sealed message waiting in memory would leave
    // storage ahead of what the dApp received, which is a gap the peer
    // answers by tearing the pairing down. Only plaintext may wait.
    const pairing = await makePairing("offline-counter");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();

    socket.connected = false;
    approveTracked(service, pairing.session.id, 1, "0xfirst");
    await settle();
    socket.connected = true;
    socket.handlers.onReconnected?.();
    await waitFor(() => socket.sent.length === 1);

    approveTracked(service, pairing.session.id, 2, "0xsecond");
    await waitFor(() => socket.sent.length === 2);

    // Both decrypt in order, which is only possible if no counter was burned
    // while the socket was down.
    const first = JSON.parse(
      await pairing.dapp.decryptMessage(relayCiphertext(socket.sent[0])),
    ) as Record<string, unknown>;
    const second = JSON.parse(
      await pairing.dapp.decryptMessage(relayCiphertext(socket.sent[1])),
    ) as Record<string, unknown>;
    expect(first["result"]).toBe("0xfirst");
    expect(second["result"]).toBe("0xsecond");
  });

  it("delivers held answers oldest first", async () => {
    const pairing = await makePairing("offline-order");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    socket.connected = false;

    approveTracked(service, pairing.session.id, 1, "0xone");
    await settle();
    approveTracked(service, pairing.session.id, 2, "0xtwo");
    await settle();

    socket.connected = true;
    socket.handlers.onReconnected?.();
    await waitFor(() => socket.sent.length === 2);

    const results = [] as unknown[];
    for (const frame of socket.sent) {
      const decoded = JSON.parse(
        await pairing.dapp.decryptMessage(relayCiphertext(frame)),
      ) as Record<string, unknown>;
      results.push(decoded["result"]);
    }
    expect(results).toEqual(["0xone", "0xtwo"]);
  });

  it("holds an answer when the socket drops before the seal", async () => {
    // Check-then-act: the reachability check happens when the message is
    // enqueued, the seal happens later inside the serialized task. The drop
    // has to land in that window, so it is applied from the outbound queue
    // itself, before sendEncryptedNow gets its turn.
    const pairing = await makePairing("drop-before-seal");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();

    const internals = Object(service) as {
      connections: Map<string, { outboundQueue: Promise<void> }>;
    };
    const conn = internals.connections.get(pairing.session.id);
    if (!conn) throw new Error("expected a live connection");
    // Ahead of this send in the queue: the socket dies while it waits.
    conn.outboundQueue = conn.outboundQueue.then(() => {
      socket.connected = false;
    });

    const sealedBefore =
      SessionStore.get(pairing.session.id)?.keyExchange.sendSeq;

    approveTracked(service, pairing.session.id, 1, "0xhash");
    await settle();

    // Nothing sealed, nothing emitted, and above all no tombstone.
    expect(socket.sent).toHaveLength(0);
    expect(socket.closeCalls).toBe(0);
    expect(SessionStore.get(pairing.session.id)).not.toBeNull();

    // The point of the in-task check: no counter was spent. Without it the
    // message is sealed and checkpointed against a socket that is already
    // gone, and the answer ends up parked as a sealed frame instead of
    // waiting in the outbox as plaintext. Both paths deliver the answer on
    // reconnect, so only this distinguishes them.
    expect(SessionStore.get(pairing.session.id)?.keyExchange.sendSeq).toBe(
      sealedBefore,
    );
    {
      const held = (
        Object(service) as {
          connections: Map<
            string,
            { pendingRetransmit: unknown; offlineOutbox: unknown[] }
          >;
        }
      ).connections.get(pairing.session.id);
      expect(held?.pendingRetransmit).toBeNull();
      expect(held?.offlineOutbox).toHaveLength(1);
    }

    socket.connected = true;
    socket.handlers.onReconnected?.();
    await waitFor(() => socket.sent.length === 1);
    expect(
      await decryptWalletFrame(pairing, socket.sent[0]),
    ).toMatchObject({ id: 1, result: "0xhash" });
  });

  it("holds an answer while the socket is connected but outside the channel", async () => {
    // A reconnected socket is connected a whole relay round trip before its
    // rejoin is acknowledged, and a refused rejoin leaves it connected and
    // never a member. The relay answers a frame from a non-member with
    // "Sender not in channel", and a rejected acknowledgement is read as
    // ambiguous: the pairing was tombstoned with a counter already spent, and
    // the dApp was told nothing, because a close_channel from a non-member is
    // refused too. Its request then hung until its own five-minute timeout.
    const pairing = await makePairing("connected-not-joined");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();

    const sealedBefore =
      SessionStore.get(pairing.session.id)?.keyExchange.sendSeq;

    // The rejoin window: the transport is up, the channel is not ours yet.
    socket.joined = false;
    approveTracked(service, pairing.session.id, 1, "0xhash");
    await settle();

    // Nothing emitted, no counter spent, and above all no tombstone.
    expect(socket.sent).toHaveLength(0);
    expect(socket.closeCalls).toBe(0);
    expect(SessionStore.get(pairing.session.id)).not.toBeNull();
    expect(SessionStore.get(pairing.session.id)?.keyExchange.sendSeq).toBe(
      sealedBefore,
    );
    {
      const internals = Object(service) as {
        connections: Map<
          string,
          { pendingRetransmit: unknown; offlineOutbox: unknown[] }
        >;
      };
      const held = internals.connections.get(pairing.session.id);
      expect(held?.pendingRetransmit).toBeNull();
      expect(held?.offlineOutbox).toHaveLength(1);
    }

    // The rejoin lands and the held answer goes out.
    socket.joined = true;
    socket.handlers.onReconnected?.();
    await waitFor(() => socket.sent.length === 1);
    expect(
      await decryptWalletFrame(pairing, socket.sent[0]),
    ).toMatchObject({ id: 1, result: "0xhash" });
  });

  it("hands the user back to the dApp after an answer, with no reason", async () => {
    // The app acts on DAPP_RETURN by backgrounding its own task on Android, so
    // the browser tab the user came from returns by itself. An absent reason
    // means "the request was answered", which is the only case that sends it.
    const pairing = await makePairing("return-after-answer");
    const { service, observed } = await reconnect(pairing.session);
    const socket = firstSocket();
    mockInNativeApp = true;

    const conn = (
      Object(service) as {
        connections: Map<
          string,
          {
            originatedViaDeepLink: boolean;
            dappInfo: { redirectUrl?: string; name: string; url: string };
          }
        >;
      }
    ).connections.get(pairing.session.id);
    if (!conn) throw new Error("expected a live connection");
    conn.originatedViaDeepLink = true;
    // dappInfo is frozen once pinned, so replace it rather than mutate it.
    conn.dappInfo = {
      ...conn.dappInfo,
      redirectUrl: "https://dapp.example/callback",
    };
    approveTracked(service, pairing.session.id, 1, "0xhash");
    await waitFor(() => socket.sent.length === 1);
    await settle();

    const returns = mockNativeMessages.filter(
      (message) => message.type === "DAPP_RETURN",
    );
    expect(returns).toHaveLength(1);
    expect(returns[0]?.payload).toEqual({
      channelId: pairing.session.id,
      redirectUrl: "https://dapp.example/callback",
    });
    expect(returns[0]?.payload).not.toHaveProperty("reason");
    // And the page is told, which is what lets an iOS approval say so.
    expect(observed.handedBack).toEqual([pairing.session.id]);
  });

  it("does not hand the user back while the answer is only held", async () => {
    // The relay is away, so the answer goes out later. Telling the user to
    // return to their browser now points them at a dApp that is still waiting.
    const pairing = await makePairing("no-return-while-held");
    const { service, observed } = await reconnect(pairing.session);
    const socket = firstSocket();
    mockInNativeApp = true;

    const conn = (
      Object(service) as {
        connections: Map<
          string,
          {
            originatedViaDeepLink: boolean;
            dappInfo: { redirectUrl?: string; name: string; url: string };
          }
        >;
      }
    ).connections.get(pairing.session.id);
    if (!conn) throw new Error("expected a live connection");
    conn.originatedViaDeepLink = true;
    conn.dappInfo = {
      ...conn.dappInfo,
      redirectUrl: "https://dapp.example/callback",
    };

    socket.connected = false;
    approveTracked(service, pairing.session.id, 1, "0xhash");
    await settle();

    expect(socket.sent).toHaveLength(0);
    expect(observed.handedBack).toEqual([]);
    expect(
      mockNativeMessages.filter((message) => message.type === "DAPP_RETURN"),
    ).toHaveLength(0);

    // Nor later, when the relay returns and the answer goes out. The hand-back
    // belongs to the moment the user approved; delivery can be minutes later,
    // and pulling them out of the wallet then is its own surprise. The dApp
    // gets its answer either way.
    socket.connected = true;
    socket.handlers.onReconnected?.();
    await waitFor(() => socket.sent.length === 1);
    await settle();
    expect(observed.handedBack).toEqual([]);
    expect(
      mockNativeMessages.filter((message) => message.type === "DAPP_RETURN"),
    ).toHaveLength(0);
  });

  it("never hands the user back on a wallet-initiated disconnect", async () => {
    // The dApp learns about a disconnect over the relay. Sending DAPP_RETURN
    // here would background the wallet on Android, dropping the user out of
    // the app they are still using, and open the dApp for no reason.
    const pairing = await makePairing("no-return-on-disconnect");
    const { service } = await reconnect(pairing.session);
    mockInNativeApp = true;

    const conn = (
      Object(service) as {
        connections: Map<
          string,
          {
            originatedViaDeepLink: boolean;
            dappInfo: { redirectUrl?: string; name: string; url: string };
          }
        >;
      }
    ).connections.get(pairing.session.id);
    if (!conn) throw new Error("expected a live connection");
    conn.originatedViaDeepLink = true;
    // dappInfo is frozen once pinned, so replace it rather than mutate it.
    conn.dappInfo = {
      ...conn.dappInfo,
      redirectUrl: "https://dapp.example/callback",
    };

    await service.disconnectSession(pairing.session.id, true);
    await settle();

    expect(
      mockNativeMessages.filter((message) => message.type === "DAPP_RETURN"),
    ).toHaveLength(0);
    // The native store is still told the session ended.
    expect(
      mockNativeMessages.some(
        (message) => message.type === "DAPP_DISCONNECTED",
      ),
    ).toBe(true);
  });

  it("does not hand the user back for a session from another device", async () => {
    // A QR-scanned session means the dApp is on a desktop, so opening its URL
    // on the phone is wrong: it can even be a http://localhost dev server.
    const pairing = await makePairing("qr-session-no-return");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    mockInNativeApp = true;

    const conn = (
      Object(service) as {
        connections: Map<
          string,
          {
            originatedViaDeepLink: boolean;
            dappInfo: { redirectUrl?: string; name: string; url: string };
          }
        >;
      }
    ).connections.get(pairing.session.id);
    if (!conn) throw new Error("expected a live connection");
    conn.originatedViaDeepLink = false;
    // dappInfo is frozen once pinned, so replace it rather than mutate it.
    conn.dappInfo = {
      ...conn.dappInfo,
      redirectUrl: "https://dapp.example/callback",
    };
    approveTracked(service, pairing.session.id, 1, "0xhash");
    await waitFor(() => socket.sent.length === 1);
    await settle();

    expect(
      mockNativeMessages.filter((message) => message.type === "DAPP_RETURN"),
    ).toHaveLength(0);
  });

  it("parks rather than tombstones when the relay refuses the frame", async () => {
    // The client believed it was in the channel and the relay disagreed: a
    // relay restart, or a stale participant it evicted. The refusal is decided
    // before anything is routed, buffered or sequenced, so the sealed frame is
    // parked and goes out unchanged once the channel is back. Reading that
    // acknowledgement as ambiguous is what retired the pairing mid-approval,
    // with a counter already spent and the dApp told nothing.
    const pairing = await makePairing("relay-refuses-frame");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();

    const sealedBefore =
      SessionStore.get(pairing.session.id)?.keyExchange.sendSeq ?? -1;

    mockRelayRefusesFrame = true;
    approveTracked(service, pairing.session.id, 1, "0xhash");
    await settle();

    // No delivery, and no teardown of any kind.
    expect(socket.sent).toHaveLength(0);
    expect(socket.closeCalls).toBe(0);
    expect(socket.leaveCalls).toBe(0);
    expect(SessionStore.get(pairing.session.id)).not.toBeNull();

    const held = (
      Object(service) as {
        connections: Map<
          string,
          {
            pendingRetransmit: unknown;
            offlineOutbox: unknown[];
            cryptoUsable: boolean;
          }
        >;
      }
    ).connections.get(pairing.session.id);
    // Sealed, so its counter is spent and checkpointed: the frame is parked and
    // the plaintext is NOT also queued, or the dApp would get it twice.
    expect(held?.cryptoUsable).toBe(true);
    expect(held?.pendingRetransmit).not.toBeNull();
    expect(held?.offlineOutbox).toHaveLength(0);
    expect(
      SessionStore.get(pairing.session.id)?.keyExchange.sendSeq,
    ).toBeGreaterThan(sealedBefore);

    // The rejoin the client kicked off lands.
    mockRelayRefusesFrame = false;
    socket.joined = true;
    socket.handlers.onReconnected?.();
    await waitFor(() => socket.sent.length === 1);

    // Exactly one answer, at the counter it was sealed with, so the dApp's
    // stream stays contiguous.
    expect(
      await decryptWalletFrame(pairing, socket.sent[0]),
    ).toMatchObject({ id: 1, result: "0xhash" });
    await settle();
    expect(socket.sent).toHaveLength(1);
  });

  it("delivers an answer exactly once when the socket drops between the checkpoint and the send", async () => {
    // The frame is sealed and its counter is spent, so it is parked for
    // retransmission. Queueing the plaintext as well would deliver the same
    // answer twice, at two different counters.
    const pairing = await makePairing("drop-after-checkpoint");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();

    mockBeforeSendHook = async () => {
      // The relay is gone by the time the frame reaches the wire, before any
      // emit: sealed and checkpointed, never sent.
      socket.connected = false;
      mockBeforeSendHook = null;
    };

    approveTracked(service, pairing.session.id, 1, "0xhash");
    await settle();
    expect(socket.closeCalls).toBe(0);

    // Sealed and checkpointed, never emitted.
    expect(socket.sent).toHaveLength(0);
    {
      // Sealed and parked, with nothing queued: queueing the plaintext too is
      // what would deliver this answer twice.
      const internals = Object(service) as {
        connections: Map<
          string,
          { pendingRetransmit: unknown; offlineOutbox: unknown[] }
        >;
      };
      const held = internals.connections.get(pairing.session.id);
      expect(held?.pendingRetransmit).not.toBeNull();
      expect(held?.offlineOutbox).toHaveLength(0);
    }

    socket.connected = true;
    socket.handlers.onReconnected?.();
    await waitFor(() => socket.sent.length >= 1);
    await settle();

    const delivered: unknown[] = [];
    for (const frame of socket.sent) {
      const decoded = JSON.parse(
        await pairing.dapp.decryptMessage(relayCiphertext(frame)),
      ) as Record<string, unknown>;
      if (decoded["result"] !== undefined) delivered.push(decoded["result"]);
    }
    expect(delivered).toEqual(["0xhash"]);
  });

  it("delivers each held answer once when two reconnects arrive together", async () => {
    const pairing = await makePairing("double-reconnect");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    socket.connected = false;

    approveTracked(service, pairing.session.id, 1, "0xone");
    await settle();
    approveTracked(service, pairing.session.id, 2, "0xtwo");
    await settle();

    socket.connected = true;
    // A fast flap: two flush loops would otherwise both peek the head entry.
    socket.handlers.onReconnected?.();
    socket.handlers.onReconnected?.();
    await waitFor(() => socket.sent.length >= 2);
    await settle();

    const delivered: unknown[] = [];
    for (const frame of socket.sent) {
      const decoded = JSON.parse(
        await pairing.dapp.decryptMessage(relayCiphertext(frame)),
      ) as Record<string, unknown>;
      delivered.push(decoded["result"]);
    }
    expect(delivered).toEqual(["0xone", "0xtwo"]);
  });

  it("refuses to hold for a socket that will never reconnect", async () => {
    // The relay force-disconnects on its rate limits and caps, and socket.io
    // never retries a server-initiated disconnect. Queueing for such a socket
    // would leave a ghost session absorbing answers until the 5 minute TTL.
    const pairing = await makePairing("no-reconnect");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    socket.connected = false;
    socket.canReconnect = false;

    approveTracked(service, pairing.session.id, 1, "0xhash");
    await settle();

    // Nothing was held for a socket that cannot come back.
    expect(socket.sent).toHaveLength(0);

    // And nothing is waiting in the outbox either, which is the difference
    // between refusing and quietly swallowing the answer.
    const internals = Object(service) as {
      connections: Map<string, { offlineOutbox: unknown[] }>;
    };
    expect(
      internals.connections.get(pairing.session.id)?.offlineOutbox,
    ).toHaveLength(0);

    // And when the client gives up, the live connection goes away so nothing
    // more is absorbed, while the pairing itself survives: the relay refuses
    // for a minute at a time on its own rate limits, and unpairing the user
    // over that would leave the dApp paired to nothing.
    socket.handlers.onReconnectAbandoned?.();
    await waitFor(
      () =>
        SessionStore.get(pairing.session.id)?.status ===
        SessionStatus.DISCONNECTED,
    );
    expect(
      (
        Object(service) as { connections: Map<string, unknown> }
      ).connections.has(pairing.session.id),
    ).toBe(false);
  });

  it("keeps a held answer when a direct send parks during the flush", async () => {
    // Both a held answer and a fresh direct send are in play when the relay
    // comes back. The direct send seals, checkpoints and then parks, because
    // the socket dies again in that window. Deciding whether the FLUSH's own
    // entry was parked by watching pendingRetransmit change identity blamed
    // the flush for the direct send's frame and dropped the held answer.
    const pairing = await makePairing("park-during-flush");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();

    socket.connected = false;
    approveTracked(service, pairing.session.id, 1, "0xheld");
    await settle();

    socket.connected = true;
    const saveThrough = SessionStore.save.bind(SessionStore);
    let armed = false;
    const save = jest
      .spyOn(SessionStore, "save")
      .mockImplementation((...args: Parameters<typeof SessionStore.save>) => {
        saveThrough(...args);
        // The checkpoint of the direct send is the exact moment its counter
        // is spent; dropping the socket here is what parks its frame.
        if (armed) {
          armed = false;
          socket.connected = false;
        }
      });

    approveTracked(service, pairing.session.id, 2, "0xdirect");
    socket.handlers.onReconnected?.();
    armed = true;
    await settle(40);
    save.mockRestore();

    socket.connected = true;
    socket.handlers.onReconnected?.();
    await settle(40);

    const delivered: unknown[] = [];
    for (const frame of socket.sent) {
      delivered.push((await decryptWalletFrame(pairing, frame))["result"]);
    }
    // The parked frame goes first because its counter is already spent, and
    // the held answer still arrives.
    expect(delivered).toEqual(["0xdirect", "0xheld"]);
  });

  it("closes an open approval when the relay will not take the session back", async () => {
    // The pairing survives a relay refusal, an approval on screen must not.
    // Approving a send for a channel with no live socket broadcasts a real
    // transaction that can never be answered, and a user who sees no result
    // sends it again and pays twice.
    const pairing = await makePairing("abandon-with-open-approval");
    const { observed } = await reconnect(pairing.session);
    const socket = firstSocket();

    await deliverEncrypted(pairing, socket, {
      type: MessageType.JSONRPC,
      jsonrpc: "2.0",
      id: 31,
      method: "qrl_requestAccounts",
      params: [],
    });
    await waitFor(() => observed.pending.length === 1);

    socket.connected = false;
    socket.canReconnect = false;
    socket.handlers.onReconnectAbandoned?.();
    await settle();

    // The UI is told to drop this channel's approvals, and the pairing is
    // still stored for a later retry.
    expect(observed.disconnected).toContain(pairing.session.id);
    expect(SessionStore.get(pairing.session.id)?.status).toBe(
      SessionStatus.DISCONNECTED,
    );
  });

  it("retires the pairing when a sealed frame is left undelivered", async () => {
    // The one case where giving up must unpair: a parked frame means its
    // counter is spent and checkpointed, so storage is ahead of what the dApp
    // received. Keeping the session would leave a gap in the AEAD stream, and
    // the peer tears the pairing down two messages later anyway.
    const pairing = await makePairing("abandon-with-parked-frame");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();

    mockBeforeSendHook = async () => {
      // Sealed and checkpointed, then the socket dies before any emit.
      socket.connected = false;
      mockBeforeSendHook = null;
    };
    approveTracked(service, pairing.session.id, 1, "0xhash");
    await settle();

    const parked = (
      Object(service) as {
        connections: Map<string, { pendingRetransmit: unknown }>;
      }
    ).connections.get(pairing.session.id)?.pendingRetransmit;
    expect(parked).not.toBeNull();

    socket.canReconnect = false;
    socket.handlers.onReconnectAbandoned?.();
    await waitFor(() => SessionStore.get(pairing.session.id) === null);
  });

  it("answers an account request that was approved while the relay was away", async () => {
    // WALLET_INFO and the JSON-RPC answer both have to reach the dApp. The
    // first version stopped after holding WALLET_INFO, so the request was
    // never answered and native never saw DAPP_CONNECTED.
    const pairing = await makePairing("accounts-offline");
    pairing.session.accountAuthorized = false;
    pairing.session.connectedAccount = "";
    const { service, observed } = await reconnect(pairing.session);
    const socket = firstSocket();

    await deliverEncrypted(pairing, socket, {
      type: MessageType.JSONRPC,
      jsonrpc: "2.0",
      id: 21,
      method: "qrl_requestAccounts",
      params: [],
    });
    await waitFor(() => observed.pending.length === 1);

    socket.connected = false;
    service.approveRequest(pairing.session.id, 21, [mockQrlAccount]);
    await settle();
    expect(socket.sent).toHaveLength(0);

    socket.connected = true;
    socket.handlers.onReconnected?.();
    await waitFor(() => socket.sent.length === 2);

    // WALLET_INFO first, then the answer the dApp is actually waiting on.
    expect(await decryptWalletFrame(pairing, socket.sent[0])).toMatchObject({
      type: MessageType.WALLET_INFO,
    });
    expect(await decryptWalletFrame(pairing, socket.sent[1])).toMatchObject({
      id: 21,
      result: [mockQrlAccount],
    });
  });

  it("keeps the rest of the queue, in order, when a flush meets a second drop", async () => {
    const pairing = await makePairing("partial-flush");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    socket.connected = false;

    approveTracked(service, pairing.session.id, 1, "0xone");
    await settle();
    approveTracked(service, pairing.session.id, 2, "0xtwo");
    await settle();
    approveTracked(service, pairing.session.id, 3, "0xthree");
    await settle();

    // The relay drops again right after the first delivery.
    socket.connected = true;
    mockSendHook = async () => {
      socket.connected = false;
      mockSendHook = null;
    };
    socket.handlers.onReconnected?.();
    await settle();

    socket.connected = true;
    socket.handlers.onReconnected?.();
    await waitFor(() => socket.sent.length === 3);

    const results: unknown[] = [];
    for (const frame of socket.sent) {
      const decoded = JSON.parse(
        await pairing.dapp.decryptMessage(relayCiphertext(frame)),
      ) as Record<string, unknown>;
      results.push(decoded["result"]);
    }
    // Nothing after the first undelivered entry was lost.
    expect(results).toEqual(["0xone", "0xtwo", "0xthree"]);
  });

  it("does not hold a goodbye for a connection that is being destroyed", async () => {
    // A TERMINATE queued while offline would be delivered later through a
    // connection restored for the same channel, which is a different
    // connection lifetime.
    const pairing = await makePairing("terminate-offline");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    socket.connected = false;

    await service.disconnectSession(pairing.session.id, true).catch(() => undefined);
    await settle();

    socket.connected = true;
    socket.handlers.onReconnected?.();
    await settle();

    expect(socket.sent).toHaveLength(0);
  });

  it("still fails closed when a send was emitted and the relay did not answer", async () => {
    // The distinction that matters: a socket known to be down emitted
    // nothing, while a rejected acknowledgement is genuinely ambiguous and
    // must still retire the session.
    const pairing = await makePairing("emitted-ambiguous");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    mockSendHook = async () => {
      throw new Error("relay ack lost");
    };

    approveTracked(service, pairing.session.id, 1, "ambiguous");
    await waitFor(() => socket.closeCalls === 1);

    expect(SessionStore.get(pairing.session.id)).toBeNull();
  });

  it("fails closed when the relay send acknowledgement is negative or unknown", async () => {
    const pairing = await makePairing();
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    mockSendHook = async () => {
      throw new Error("relay ack lost");
    };

    approveTracked(service, pairing.session.id, 1, "ambiguous");
    await waitFor(() => socket.closeCalls === 1);

    expect(socket.sent).toHaveLength(1);
    expect(socket.disconnectCalls).toBe(1);
    expect(SessionStore.get(pairing.session.id)).toBeNull();
  });

  it("retires local keys after an ambiguous send even if relay tombstoning fails", async () => {
    const pairing = await makePairing("ambiguous-send-close-failure");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    mockSendHook = async () => {
      throw new Error("relay ack lost");
    };
    mockCloseHook = async () => false;

    approveTracked(service, pairing.session.id, 1, "ambiguous");
    await waitFor(() => socket.disconnectCalls === 1);

    expect(socket.closeCalls).toBe(1);
    expect(SessionStore.get(pairing.session.id)).toBeNull();
  });

  it("clears stale counters even when storage rewrites and relay close both fail", async () => {
    const pairing = await makePairing();
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    storage.failWrites = new Error("persistent quota failure");
    mockCloseHook = async () => {
      throw new Error("relay unavailable");
    };

    approveTracked(service, pairing.session.id, 1, "must not send");
    await waitFor(() => socket.disconnectCalls === 1);

    expect(socket.sent).toHaveLength(0);
    expect(socket.closeCalls).toBe(1);
    expect(localStorage.getItem("qrlconnect:sessions")).toBeNull();
  });

  it("does not resurrect a session when disconnect wins a delayed checkpoint race", async () => {
    const pairing = await makePairing();
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    let releaseExport: () => void = () => undefined;
    const exportGate = new Promise<void>((resolve) => {
      releaseExport = resolve;
    });
    let markExportStarted: () => void = () => undefined;
    const exportStarted = new Promise<void>((resolve) => {
      markExportStarted = resolve;
    });
    const originalExport = KeyExchange.prototype.exportPersisted;
    const exportSpy = jest
      .spyOn(KeyExchange.prototype, "exportPersisted")
      .mockImplementation(async function (this: KeyExchange) {
        markExportStarted();
        await exportGate;
        return originalExport.call(this);
      });

    try {
      approveTracked(service, pairing.session.id, 1, "delayed");
      await exportStarted;
      await service.disconnectSession(pairing.session.id);
      expect(SessionStore.get(pairing.session.id)).toBeNull();

      releaseExport();
      await waitFor(() => (errorSpy?.mock.calls.length ?? 0) > 0);

      expect(socket.sent).toHaveLength(0);
      expect(SessionStore.get(pairing.session.id)).toBeNull();
    } finally {
      releaseExport();
      exportSpy.mockRestore();
    }
  });

  it("drops a delayed checkpoint when another tab advances the wallet epoch", async () => {
    const pairing = await makePairing("cross-tab-late-checkpoint");
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();
    let releaseExport: () => void = () => undefined;
    const exportGate = new Promise<void>((resolve) => {
      releaseExport = resolve;
    });
    let markExportStarted: () => void = () => undefined;
    const exportStarted = new Promise<void>((resolve) => {
      markExportStarted = resolve;
    });
    const originalExport = KeyExchange.prototype.exportPersisted;
    const exportSpy = jest
      .spyOn(KeyExchange.prototype, "exportPersisted")
      .mockImplementation(async function (this: KeyExchange) {
        markExportStarted();
        await exportGate;
        return originalExport.call(this);
      });

    try {
      approveTracked(service, pairing.session.id, 1, "delayed");
      await exportStarted;
      advanceWalletEpoch();
      releaseExport();

      await waitFor(() => socket.disconnectCalls === 1);
      expect(socket.sent).toHaveLength(0);
      expect(SessionStore.get(pairing.session.id)).toBeNull();
    } finally {
      releaseExport();
      exportSpy.mockRestore();
    }
  });
});

describe("wallet-side direct relay RPC enforcement", () => {
  it("stages only bounded canonical qrlconnect URI envelopes", () => {
    expect(DAppConnectService.isConnectionURI("qrlconnect://?q=PQP3DATA")).toBe(true);
    expect(DAppConnectService.isConnectionURI("QrlConnect://?q=PQP3DATA")).toBe(true);
    expect(DAppConnectService.isConnectionURI("qrlconnect:?q=PQP3DATA")).toBe(false);
    expect(DAppConnectService.isConnectionURI("qrlconnect:/?q=PQP3DATA")).toBe(false);
    expect(DAppConnectService.isConnectionURI("qrlconnect://path?q=PQP3DATA")).toBe(false);
    expect(DAppConnectService.isConnectionURI("qrlconnect://?q=a&q=b")).toBe(false);
    expect(
      DAppConnectService.isConnectionURI(
        "qrlconnect://?q=PQP3DATA&r=http%3A%2F%2Frelay.example",
      ),
    ).toBe(false);
    expect(
      DAppConnectService.isConnectionURI(
        "qrlconnect://?q=PQP3DATA&r=https%3A%2F%2Frelay.example%2F%3Fcap%3Draw",
      ),
    ).toBe(false);
    expect(
      DAppConnectService.isConnectionURI(
        "qrlconnect://?wake=00112233-4455-6677-8899-aabbccddeeff&r=https%3A%2F%2Frelay.example",
      ),
    ).toBe(false);
    expect(DAppConnectService.isConnectionURI(`qrlconnect://?q=${"A".repeat(4097)}`)).toBe(
      false,
    );
  });

  it("keeps qrl_accounts local and empty until this session is authorized", async () => {
    const pairing = await makePairing("accounts-disclosure-boundary");
    pairing.session.accountAuthorized = false;
    pairing.session.connectedAccount = "";
    await reconnect(pairing.session);
    const socket = firstSocket();

    await deliverEncrypted(pairing, socket, {
      type: MessageType.JSONRPC,
      jsonrpc: "2.0",
      id: 10,
      method: "qrl_accounts",
      params: [],
    });
    await waitFor(() => socket.sent.length === 1);

    expect(await decryptWalletFrame(pairing, socket.sent[0])).toMatchObject({
      type: MessageType.JSONRPC,
      id: 10,
      result: [],
    });
  });

  it("drops JSON-RPC IDs outside the SDK wire contract", async () => {
    const pairing = await makePairing("invalid-wire-ids");
    const { observed } = await reconnect(pairing.session);
    const socket = firstSocket();
    const invalidIds: unknown[] = [
      "",
      "x".repeat(129),
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ];

    for (const id of invalidIds) {
      await deliverEncrypted(pairing, socket, {
        type: MessageType.JSONRPC,
        jsonrpc: "2.0",
        id,
        method: "qrl_accounts",
        params: [],
      });
    }
    await waitFor(
      () =>
        SessionStore.get(pairing.session.id)?.keyExchange.recvSeq ===
        pairing.session.keyExchange.recvSeq + invalidIds.length,
    );

    expect(socket.sent).toHaveLength(0);
    expect(observed.pending).toHaveLength(0);
  });

  it("rejects signing before account consent even for the live wallet address", async () => {
    const pairing = await makePairing("signing-consent-boundary");
    pairing.session.accountAuthorized = false;
    pairing.session.connectedAccount = "";
    const { observed } = await reconnect(pairing.session);
    const socket = firstSocket();

    await deliverEncrypted(pairing, socket, {
      type: MessageType.JSONRPC,
      jsonrpc: "2.0",
      id: 11,
      method: "qrl_signMessage",
      params: [mockQrlAccount, "0x01"],
    });
    await waitFor(() => socket.sent.length === 1);

    expect(await decryptWalletFrame(pairing, socket.sent[0])).toMatchObject({
      id: 11,
      error: { code: 4100 },
    });
    expect(observed.pending).toHaveLength(0);
  });

  it("requires an exact authorized and live from address for transaction approval", async () => {
    const pairing = await makePairing("transaction-account-binding");
    const { observed } = await reconnect(pairing.session);
    const socket = firstSocket();

    await deliverEncrypted(pairing, socket, {
      type: MessageType.JSONRPC,
      jsonrpc: "2.0",
      id: 12,
      method: "qrl_sendTransaction",
      params: [
        {
          from: mockQrlRecipient,
          to: mockQrlOther,
          value: "0x0",
        },
      ],
    });
    await waitFor(() => socket.sent.length === 1);

    expect(await decryptWalletFrame(pairing, socket.sent[0])).toMatchObject({
      id: 12,
      error: { code: 4100 },
    });
    expect(observed.pending).toHaveLength(0);
  });

  it("rejects an otherwise-valid signer that differs only by hex case", async () => {
    const canonical = `Q${"ABCDEF".repeat(21)}AB`;
    const caseVariant = `Q${canonical.slice(1).toLowerCase()}`;
    (
      Object(mockedStore.qrlStore.activeAccount) as {
        accountAddress: string;
      }
    ).accountAddress = canonical;
    const pairing = await makePairing("account-case-binding");
    pairing.session.connectedAccount = canonical;
    const { observed } = await reconnect(pairing.session);
    const socket = firstSocket();

    await deliverEncrypted(pairing, socket, {
      type: MessageType.JSONRPC,
      jsonrpc: "2.0",
      id: 120,
      method: "qrl_signMessage",
      params: [caseVariant, "0x01"],
    });
    await waitFor(() => socket.sent.length === 1);

    expect(await decryptWalletFrame(pairing, socket.sent[0])).toMatchObject({
      id: 120,
      error: { code: 4100 },
    });
    expect(observed.pending).toHaveLength(0);
  });

  it("requires pinned origin metadata before queuing any JSON-RPC approval", async () => {
    const pairing = await makePairing("identity-before-rpc");
    pairing.session.dappInfo = { ...PENDING_DAPP_INFO };
    pairing.session.originatorInfoReceived = false;
    pairing.session.accountAuthorized = false;
    pairing.session.connectedAccount = "";
    const { observed } = await reconnect(pairing.session);
    const socket = firstSocket();

    await deliverEncrypted(pairing, socket, {
      type: MessageType.JSONRPC,
      jsonrpc: "2.0",
      id: 13,
      method: "qrl_requestAccounts",
      params: [],
    });
    await waitFor(() => socket.sent.length === 1);

    expect(await decryptWalletFrame(pairing, socket.sent[0])).toMatchObject({
      id: 13,
      error: { code: 4100 },
    });
    expect(observed.pending).toHaveLength(0);
  });

  it("checkpoints account consent before disclosing it and persists the binding", async () => {
    const pairing = await makePairing("account-consent-checkpoint");
    pairing.session.accountAuthorized = false;
    pairing.session.connectedAccount = "";
    const { service, observed } = await reconnect(pairing.session);
    const socket = firstSocket();

    await deliverEncrypted(pairing, socket, {
      type: MessageType.JSONRPC,
      jsonrpc: "2.0",
      id: 14,
      method: "qrl_requestAccounts",
      params: [],
    });
    await waitFor(() => observed.pending.length === 1);

    const authorizationAtRelaySend: boolean[] = [];
    mockSendHook = async () => {
      authorizationAtRelaySend.push(
        SessionStore.get(pairing.session.id)?.accountAuthorized ?? false,
      );
    };
    service.approveRequest(pairing.session.id, 14, [
      mockQrlAccount,
    ]);
    await waitFor(() => socket.sent.length === 2);

    expect(authorizationAtRelaySend).toEqual([true, true]);
    expect(SessionStore.get(pairing.session.id)).toMatchObject({
      accountAuthorized: true,
      connectedAccount: mockQrlAccount,
    });
    expect(await decryptWalletFrame(pairing, socket.sent[0])).toMatchObject({
      type: MessageType.WALLET_INFO,
      accounts: [mockQrlAccount],
      chainId: "0x539",
    });
    expect(await decryptWalletFrame(pairing, socket.sent[1])).toMatchObject({
      type: MessageType.JSONRPC,
      id: 14,
      result: [mockQrlAccount],
    });
  });

  it("does not authorize or disclose an account when the request is rejected", async () => {
    const pairing = await makePairing("account-consent-rejected");
    pairing.session.accountAuthorized = false;
    pairing.session.connectedAccount = "";
    const { service, observed } = await reconnect(pairing.session);
    const socket = firstSocket();

    await deliverEncrypted(pairing, socket, {
      type: MessageType.JSONRPC,
      jsonrpc: "2.0",
      id: 15,
      method: "qrl_requestAccounts",
      params: [],
    });
    await waitFor(() => observed.pending.length === 1);
    service.rejectRequest(pairing.session.id, 15);
    await waitFor(() => socket.sent.length === 1);

    expect(await decryptWalletFrame(pairing, socket.sent[0])).toMatchObject({
      id: 15,
      error: { code: 4001 },
    });
    expect(SessionStore.get(pairing.session.id)).toMatchObject({
      accountAuthorized: false,
      connectedAccount: "",
    });
  });

  it("fails closed if origin identity or redirect changes after being pinned", async () => {
    const pairing = await makePairing("origin-mutation");
    await reconnect(pairing.session);
    const socket = firstSocket();

    await deliverEncrypted(pairing, socket, {
      type: MessageType.ORIGINATOR_INFO,
      originatorInfo: {
        ...pairing.session.dappInfo,
        name: "Replacement dApp",
        redirectUrl: "https://attacker.example/return",
      },
    });
    await waitFor(() => socket.disconnectCalls === 1);

    expect(socket.closeCalls).toBe(1);
    expect(SessionStore.get(pairing.session.id)).toBeNull();
  });

  it("drops oversized ciphertext frames before AEAD accounting", async () => {
    const pairing = await makePairing("oversized-ciphertext");
    await reconnect(pairing.session);
    const socket = firstSocket();
    const before = SessionStore.get(pairing.session.id)?.keyExchange.recvSeq;

    socket.handlers.onMessage({
      id: pairing.session.id,
      clientType: "dapp",
      message: "A".repeat(256 * 1024 + 1),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(socket.sent).toHaveLength(0);
    expect(SessionStore.get(pairing.session.id)?.keyExchange.recvSeq).toBe(before);
  });

  it("rejects raw broadcast and unknown prefixed methods without proxying them", async () => {
    for (const [index, method] of [
      "qrl_sendRawTransaction",
      "wallet_signFuturePayload",
    ].entries()) {
      const pairing = await makePairing(`closed-policy-${index}`);
      const { service, observed } = await reconnect(pairing.session);
      const socket = mockSocketClientInstances[index];
      if (!socket) throw new Error("Expected policy test socket");
      const ciphertext = await pairing.dapp.encryptMessage(
        JSON.stringify({
          type: MessageType.JSONRPC,
          jsonrpc: "2.0",
          id: index + 1,
          method,
          params: ["0xdeadbeef"],
        }),
      );
      socket.handlers.onMessage({
        id: pairing.session.id,
        clientType: "dapp",
        message: ciphertext,
      });
      await waitFor(() => socket.sent.length === 1);

      const responseMessage = socket.sent[0]?.message;
      if (typeof responseMessage !== "string")
        throw new Error("Expected encrypted response");
      const response = JSON.parse(
        await pairing.dapp.decryptMessage(responseMessage),
      );
      expect(response).toMatchObject({
        type: MessageType.JSONRPC,
        id: index + 1,
        error: { code: -32601 },
      });
      expect(observed.pending).toHaveLength(0);
      await service.disconnectSession(pairing.session.id);
      await Promise.resolve();
    }
  });

  it("rejects a legacy-width qrl_getLogs topic before provider forwarding", async () => {
    const pairing = await makePairing("legacy-log-topic");
    const { observed } = await reconnect(pairing.session);
    const socket = firstSocket();

    await deliverEncrypted(pairing, socket, {
      type: MessageType.JSONRPC,
      jsonrpc: "2.0",
      id: 40,
      method: "qrl_getLogs",
      params: [
        {
          address: mockQrlAccount,
          topics: [`0x${"ab".repeat(32)}`],
        },
      ],
    });
    await waitFor(() => socket.sent.length === 1);

    expect(await decryptWalletFrame(pairing, socket.sent[0])).toMatchObject({
      type: MessageType.JSONRPC,
      id: 40,
      error: {
        code: -32602,
        message: expect.stringContaining("exact 64-byte VM64"),
      },
    });
    expect(observed.pending).toHaveLength(0);
  });

  it("rejects over-budget typed data before it enters the approval queue", async () => {
    const pairing = await makePairing("typed-data-ingress-limit");
    const { observed } = await reconnect(pairing.session);
    const socket = firstSocket();
    const payload = {
      types: {
        QRLDomain: [{ name: "name", type: "string" }],
        Payload: [{ name: "values", type: "uint8[]" }],
      },
      primaryType: "Payload",
      domain: { name: "Malicious direct relay dApp" },
      message: { values: new Array(257).fill(1) },
    };
    const ciphertext = await pairing.dapp.encryptMessage(
      JSON.stringify({
        type: MessageType.JSONRPC,
        jsonrpc: "2.0",
        id: 41,
        method: "qrl_signTypedData",
        params: [mockQrlAccount, payload],
      }),
    );
    socket.handlers.onMessage({
      id: pairing.session.id,
      clientType: "dapp",
      message: ciphertext,
    });
    await waitFor(() => socket.sent.length === 1);

    const responseMessage = socket.sent[0]?.message;
    if (typeof responseMessage !== "string")
      throw new Error("Expected encrypted response");
    const response = JSON.parse(
      await pairing.dapp.decryptMessage(responseMessage),
    );
    expect(response).toMatchObject({
      type: MessageType.JSONRPC,
      id: 41,
      error: { code: -32602 },
    });
    expect(observed.pending).toHaveLength(0);
  });

  it("rejects malformed transaction objects before approval rendering", async () => {
    const pairing = await makePairing("malformed-transaction-ingress");
    const { observed } = await reconnect(pairing.session);
    const socket = firstSocket();
    const ciphertext = await pairing.dapp.encryptMessage(
      JSON.stringify({
        type: MessageType.JSONRPC,
        jsonrpc: "2.0",
        id: 43,
        method: "qrl_sendTransaction",
        params: [
          {
            from: mockQrlAccount,
            to: mockQrlRecipient,
            value: "0x0",
            data: { crashApprovalReview: true },
          },
        ],
      }),
    );
    socket.handlers.onMessage({
      id: pairing.session.id,
      clientType: "dapp",
      message: ciphertext,
    });
    await waitFor(() => socket.sent.length === 1);

    const responseMessage = socket.sent[0]?.message;
    if (typeof responseMessage !== "string")
      throw new Error("Expected encrypted response");
    const response = JSON.parse(
      await pairing.dapp.decryptMessage(responseMessage),
    );
    expect(response).toMatchObject({
      type: MessageType.JSONRPC,
      id: 43,
      error: { code: -32602 },
    });
    expect(observed.pending).toHaveLength(0);
  });

  it("still queues a bounded direct typed-data request for explicit approval", async () => {
    const pairing = await makePairing("typed-data-ingress-valid");
    const { observed } = await reconnect(pairing.session);
    const socket = firstSocket();
    const ciphertext = await pairing.dapp.encryptMessage(
      JSON.stringify({
        type: MessageType.JSONRPC,
        jsonrpc: "2.0",
        id: 42,
        method: "qrl_signTypedData",
        params: [
          mockQrlAccount,
          {
            types: {
              QRLDomain: [{ name: "name", type: "string" }],
              Payload: [{ name: "value", type: "uint16" }],
            },
            primaryType: "Payload",
            domain: { name: "Bounded direct relay dApp" },
            message: { value: 7 },
          },
        ],
      }),
    );
    socket.handlers.onMessage({
      id: pairing.session.id,
      clientType: "dapp",
      message: ciphertext,
    });
    await waitFor(() => observed.pending.length === 1);

    expect(observed.pending[0]).toMatchObject({
      id: 42,
      method: "qrl_signTypedData",
    });
    expect(socket.sent).toHaveLength(0);
  });
});

describe("wallet service reconnect ownership", () => {
  it("physically prunes v2 records without attempting to restore them", async () => {
    const pairing = await makePairing();
    localStorage.setItem(
      "qrlconnect:sessions",
      JSON.stringify([{ ...pairing.session, version: 3 }]),
    );
    const service = new DAppConnectService();
    services.push(service);

    await service.reconnectAll();

    expect(localStorage.getItem("qrlconnect:sessions")).toBeNull();
    expect(mockSocketClientInstances).toHaveLength(0);
  });

  it("reconnects a v4 session with its existing counters", async () => {
    const pairing = await makePairing();
    pairing.session.keyExchange.sendSeq = 9;
    pairing.session.keyExchange.recvSeq = 11;
    const { service } = await reconnect(pairing.session);
    const socket = firstSocket();

    expect(socket.connectCalls).toBe(1);
    expect(socket.joinCalls).toEqual([pairing.session.id]);
    expect(SessionStore.get(pairing.session.id)?.keyExchange).toMatchObject({
      sendSeq: 9,
      recvSeq: 11,
    });

    await service.disconnectSession(pairing.session.id);
  });

  it("coalesces concurrent reconnectAll calls within one wallet tab", async () => {
    const pairing = await makePairing();
    SessionStore.save(pairing.session);
    const service = new DAppConnectService();
    services.push(service);

    await Promise.all([service.reconnectAll(), service.reconnectAll()]);

    expect(mockSocketClientInstances).toHaveLength(1);
    expect(mockSocketClientInstances[0]?.joinCalls).toEqual([
      pairing.session.id,
    ]);
  });

  it("allows only one wallet tab to own and restore a channel", async () => {
    const pairing = await makePairing();
    SessionStore.save(pairing.session);
    const first = new DAppConnectService();
    const second = new DAppConnectService();
    services.push(first, second);

    await Promise.all([first.reconnectAll(), second.reconnectAll()]);

    expect(mockSocketClientInstances).toHaveLength(1);
    expect(mockSocketClientInstances[0]?.joinCalls).toEqual([
      pairing.session.id,
    ]);
  });

  it("releases origin ownership after teardown so another tab can acquire it", async () => {
    const firstPairing = await makePairing("first-owner");
    const firstConnection = await reconnect(firstPairing.session);
    await firstConnection.service.disconnectSession(firstPairing.session.id);
    await Promise.resolve();

    const secondPairing = await makePairing("second-owner");
    SessionStore.save(secondPairing.session);
    const secondService = new DAppConnectService();
    services.push(secondService);
    await secondService.reconnectAll();

    expect(mockSocketClientInstances).toHaveLength(2);
    expect(mockSocketClientInstances[1]?.joinCalls).toEqual([
      secondPairing.session.id,
    ]);
  });

  it("does not restore sessions when origin-wide locking is unavailable", async () => {
    const pairing = await makePairing();
    SessionStore.save(pairing.session);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });
    const service = new DAppConnectService();
    services.push(service);

    await service.reconnectAll();

    expect(mockSocketClientInstances).toHaveLength(0);
  });

  it("does not reconnect a persisted channel after this wallet tab clears it", async () => {
    const pairing = await makePairing();
    SessionStore.save(pairing.session);
    const service = new DAppConnectService();
    services.push(service);

    await service.clearAllSessions();
    expect(SessionStore.get(pairing.session.id)).toBeNull();

    await service.reconnectAll();
    expect(mockSocketClientInstances).toHaveLength(0);
  });

  it("tears down a live owner when a second tab clears the wallet identity", async () => {
    const pairing = await makePairing("live-other-tab");
    const { service: owner } = await reconnect(pairing.session);
    const socket = firstSocket();
    const clearingTab = new DAppConnectService();
    services.push(clearingTab);

    await clearingTab.clearAllSessions();
    await waitFor(() => socket.disconnectCalls === 1);

    expect(socket.closeCalls).toBe(1);
    expect(SessionStore.get(pairing.session.id)).toBeNull();
    await owner.reconnectAll();
    expect(mockSocketClientInstances).toHaveLength(1);
  });

  it("preserves a fresh current session when an old tab handles the epoch late", async () => {
    const oldPairing = await makePairing("delayed-old-tab");
    const { service: delayedOwner } = await reconnect(oldPairing.session);
    const oldSocket = firstSocket();

    // Model a suspended tab that receives storage/BroadcastChannel delivery
    // only after another tab has advanced the epoch and paired a new session.
    delayedOwner.dispose();
    const currentEpoch = advanceWalletEpoch();
    const freshPairing = await makePairing("fresh-current-tab");
    SessionStore.save(freshPairing.session, currentEpoch);

    const delayedHandler = Object(delayedOwner) as {
      handleWalletEpochAdvance: (epoch: string) => void;
    };
    delayedHandler.handleWalletEpochAdvance(currentEpoch);
    await waitFor(() => oldSocket.disconnectCalls === 1);

    expect(SessionStore.get(freshPairing.session.id)).toMatchObject({
      id: freshPairing.session.id,
      walletEpoch: currentEpoch,
    });
    expect(SessionStore.get(oldPairing.session.id)).toBeNull();
  });
});
