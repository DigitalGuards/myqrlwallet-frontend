/**
 * DApp Connect Service — wallet-side orchestrator for incoming dApp connections.
 *
 * Handles PQP3 URI parsing, relay communication, the post-quantum handshake,
 * request routing, and session management. All approval UI renders in the
 * WebView (single source of truth).
 */

import {
  KeyExchange,
  type SynAckMessage,
  type AckMessage,
} from "./KeyExchange";
import {
  parseConnectionURI,
  parseWakeURI,
  parseRelayUrl,
  cidToString,
  computeFingerprint,
  fingerprintEquals,
} from "./qrUri";
import {
  ML_KEM_768_PK_LEN,
  fromBase64,
  toBase64,
  zeroize,
} from "./PQCrypto";
import { SocketClient } from "./SocketClient";
import { RequestHandler } from "./RequestHandler";
import {
  isExactQrlAccount,
  Q_ADDRESS_PATTERN,
} from "./accountBinding";
import { SessionStore } from "./SessionStore";
import {
  PENDING_DAPP_INFO,
  dappInfoEquals,
  parseDAppInfo,
} from "./dappMetadata";
import {
  type DAppInfo,
  type DAppSession,
  type PendingDAppRequest,
  type RelayMessage,
  type JsonRpcResponse,
  KeyExchangeMessageType,
  MessageType,
  SessionStatus,
} from "./types";
import {
  isInNativeApp,
  parseExternalHttpUrl,
  sendToNative,
  triggerHaptic,
  logToNative,
} from "@/utils/nativeApp";
import { store } from "@/stores/store";
import {
  advanceWalletEpoch,
  getWalletEpoch,
  isWalletEpochCurrent,
  subscribeWalletEpoch,
  type WalletEpoch,
} from "@/utils/walletEpoch";

function dlog(msg: string): void {
  console.log(`[DAppConnect] ${msg}`);
  logToNative(`[DAppConnect] ${msg}`);
}

export const DEFAULT_RELAY_URL = "https://qrlwallet.com";
// Grace period before a dApp that left the relay channel is torn down. On a
// same-device deep-link round trip the dApp's browser tab is suspended while
// the wallet is foregrounded, so its relay socket drops; the relay buffer
// (5 min) and channel (30 min) easily outlive that, and the SDK re-joins the
// same channel on resume. 30s was shorter than a real browser-to-wallet-and-
// back round trip and tore down recoverable sessions; 90s comfortably covers
// it without leaving a genuinely-gone dApp "active" for long.
const DAPP_REJOIN_GRACE_MS = 90000;
// While an approval for the channel is still waiting on the user, the grace
// period re-arms instead of reaping the session (approving can easily take
// longer than 90s with FaceID + reading the request). Bounded so a session
// whose approval is simply abandoned still gets cleaned up.
const DAPP_LEAVE_APPROVAL_CAP_MS = 10 * 60 * 1000;
// AEAD nonces derive from the recv counter with no gap tolerance, so a relay
// buffer drop (5-min TTL / 50-msg cap) desyncs the stream unrecoverably and
// every later open fails. Two consecutive failures cannot happen on a healthy
// stream; requiring the second guards against one-off injected junk.
const MAX_DECRYPT_FAILURES = 2;
const TERMINATE_SEND_TIMEOUT_MS = 800;
const SESSION_LOCK_NAME = "qrlconnect:wallet-owner";
const STORE_MAINTENANCE_CHANNEL = "__qrlconnect_store_maintenance__";
const MAX_BUFFERED_MESSAGES = 50;
const MAX_CIPHERTEXT_LENGTH = 256 * 1024;
const MAX_CONNECTION_URI_LENGTH = 4096;
const ML_KEM_768_PK_B64_LEN = Math.ceil(ML_KEM_768_PK_LEN / 3) * 4;
const ACCOUNT_BOUND_METHODS = new Set([
  "qrl_sendTransaction",
  "qrl_signTransaction",
  "qrl_signMessage",
  "qrl_signTypedData",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpectedDappFrame(
  value: unknown,
  channelId: string,
): value is RelayMessage {
  if (!isRecord(value)) return false;
  const message = value["message"];
  return (
    value["id"] === channelId &&
    value["clientType"] === "dapp" &&
    ((typeof message === "string" && message.length <= MAX_CIPHERTEXT_LENGTH) ||
      isRecord(message))
  );
}

function requestIdKey(id: string | number): string {
  return `${typeof id}:${String(id)}`;
}

function activeWalletAccount(): string | null {
  const address = store.qrlStore.activeAccount?.accountAddress;
  return typeof address === "string" && Q_ADDRESS_PATTERN.test(address)
    ? address
    : null;
}

function requestedAccount(method: string, params: unknown[] | undefined): string | null {
  if (method === "qrl_signMessage" || method === "qrl_signTypedData") {
    const signer = params?.[0];
    return typeof signer === "string" ? signer : null;
  }
  if (method === "qrl_sendTransaction" || method === "qrl_signTransaction") {
    const transaction = params?.[0];
    if (!isRecord(transaction)) return null;
    const from = transaction["from"];
    return typeof from === "string" ? from : null;
  }
  return null;
}

function validateBufferedMessages(
  value: unknown,
  channelId: string,
): RelayMessage[] {
  if (!Array.isArray(value) || value.length > MAX_BUFFERED_MESSAGES) {
    throw new Error("Relay returned an invalid buffered message list");
  }
  const messages: RelayMessage[] = [];
  for (const item of value) {
    if (!isExpectedDappFrame(item, channelId)) {
      throw new Error("Relay returned a malformed buffered message");
    }
    messages.push(item);
  }
  return messages;
}

function decodeRelayPublicKey(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length !== ML_KEM_768_PK_B64_LEN
  ) {
    throw new Error("Relay returned an invalid ML-KEM public key");
  }
  try {
    const pk = fromBase64(value);
    if (pk.length !== ML_KEM_768_PK_LEN || toBase64(pk) !== value) {
      throw new Error("non-canonical key");
    }
    return pk;
  } catch {
    throw new Error("Relay returned an invalid ML-KEM public key");
  }
}

/**
 * Origin-wide wallet ownership backed by the Web Locks API.
 *
 * A Promise queue only serializes one JS realm. Without an origin-wide lock,
 * two wallet tabs can restore the same key/counters and both seal under the
 * same AES-GCM nonce. One global owner (rather than one owner per channel)
 * also makes SessionStore's array read/modify/write safe across channels.
 * Browsers without Web Locks fail closed for QRL Connect rather than offering
 * unsafe persistent-session semantics.
 */
class SessionOwnership {
  private readonly channels = new Set<string>();
  private releaseLock: (() => void) | null = null;
  private acquiring: Promise<boolean> | null = null;

  async acquire(channelId: string): Promise<boolean> {
    if (this.channels.has(channelId)) return true;
    if (this.releaseLock) {
      this.channels.add(channelId);
      return true;
    }
    if (
      typeof navigator === "undefined" ||
      typeof navigator.locks?.request !== "function"
    ) {
      return false;
    }

    this.acquiring ??= this.acquireGlobalLock().finally(() => {
      this.acquiring = null;
    });
    const acquired = await this.acquiring;
    if (acquired) this.channels.add(channelId);
    return acquired;
  }

  owns(channelId: string): boolean {
    return this.channels.has(channelId);
  }

  private async acquireGlobalLock(): Promise<boolean> {
    if (this.releaseLock) return true;

    let resolveAcquired: (acquired: boolean) => void = () => undefined;
    const acquired = new Promise<boolean>((resolve) => {
      resolveAcquired = resolve;
    });
    let releaseLock: () => void = () => undefined;
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let callbackRan = false;

    try {
      void navigator.locks
        .request(
          SESSION_LOCK_NAME,
          { mode: "exclusive", ifAvailable: true },
          (lock) => {
            callbackRan = true;
            if (!lock) {
              resolveAcquired(false);
              return undefined;
            }
            this.releaseLock = releaseLock;
            resolveAcquired(true);
            return holdLock;
          },
        )
        .catch((err: unknown) => {
          if (!callbackRan) resolveAcquired(false);
          console.error(
            "[DAppConnect] Failed to acquire session ownership lock:",
            err,
          );
        });
    } catch (err) {
      if (!callbackRan) resolveAcquired(false);
      console.error(
        "[DAppConnect] Failed to request session ownership lock:",
        err,
      );
    }

    return acquired;
  }

  release(channelId: string): void {
    if (!this.channels.delete(channelId) || this.channels.size > 0) return;
    const release = this.releaseLock;
    this.releaseLock = null;
    release?.();
  }
}

interface ActiveConnection {
  socketClient: SocketClient;
  keyExchange: KeyExchange;
  dappInfo: DAppInfo;
  channelId: string;
  originatorInfoReceived: boolean;
  messageQueue: Promise<void>;
  // Serializes every exported counter snapshot and SessionStore write. Inbound
  // and outbound crypto can advance different counters concurrently; allowing
  // their async exports to write out of order could regress one on disk.
  persistenceQueue: Promise<void>;
  // Every wallet ciphertext for this channel (including TERMINATE) passes
  // through one encrypt -> checkpoint -> relay-send queue. This preserves
  // contiguous counter order even when UI/RPC callers send concurrently.
  outboundQueue: Promise<void>;
  // Cleared synchronously on any checkpoint/encryption failure. Queue tasks
  // re-check it after each await so no ciphertext escapes a failed-closed
  // session while relay teardown is in flight.
  cryptoUsable: boolean;
  // Relay URL the live SocketClient is actually talking to. Tracked
  // separately from the persisted session so persistSession() can store
  // the real URL rather than falling back to DEFAULT_RELAY_URL on first
  // save, which would silently point reconnects at prod when running on
  // dev/staging.
  relayUrl: string;
  // Session-scoped account consent. Null until qrl_requestAccounts is
  // approved; never inferred from whichever wallet account is currently active.
  authorizedAccount: string | null;
  // Snapshot of the original QR commitment. A duplicate cid must compare
  // directly with this value: recomputing from an attacker-chosen cap and
  // its matching fp would accept an unrelated bearer capability. The raw
  // capability itself is never retained after key derivation.
  qrFingerprint?: Uint8Array;
  // True only when the connection was opened from a same-device deep link
  // (qrlconnect:// tapped in the phone browser), not a QR scan. Gates the
  // return-to-dApp peer redirect: bouncing to the dApp URL only makes sense
  // on the same device. A QR scan means the dApp is on another device.
  originatedViaDeepLink: boolean;
  // The SYNACK wire message for a handshake that has not completed yet.
  // Kept so a socket flap between our SYNACK and the dApp's ACK does not
  // strand the pairing: on rejoin we re-send the identical SYNACK (the
  // AEAD nonce is deterministic, so the bytes are stable) and the dApp
  // either consumes it or re-sends its cached ACK. Cleared once keys are
  // exchanged.
  pendingSynAck?: SynAckMessage;
  // Identity epoch captured when this connection was created or restored.
  // Checkpoints from an older epoch must never survive a wallet wipe.
  walletEpoch: WalletEpoch;
}

type ServiceEventHandler = {
  onSessionsChanged: () => void;
  onPendingRequest: (request: PendingDAppRequest) => void;
  onSessionConnected: (sessionId: string) => void;
  onSessionDisconnected: (sessionId: string) => void;
  /**
   * Whether an approval for this channel is still waiting on the user.
   * Optional so existing wirings/mocks stay valid; when absent the
   * stale-session grace behaves as before (no approval-aware extension).
   */
  hasPendingApprovalsForChannel?: (channelId: string) => boolean;
};

interface RpcRequestProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

interface PendingRestrictedRequestState {
  method: string;
  /** Authorization snapshot captured when an account-bound request entered. */
  authorizedAccount: string | null;
}

function getRequestProvider(web3: unknown): RpcRequestProvider | null {
  if (typeof web3 !== "object" || web3 === null) return null;
  const provider = (web3 as { currentProvider?: unknown }).currentProvider;
  if (typeof provider !== "object" || provider === null) return null;
  if (typeof (provider as { request?: unknown }).request !== "function")
    return null;
  return provider as RpcRequestProvider;
}

function canonicalChainId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 66 ||
    !/^0x[0-9a-fA-F]+$/.test(value)
  ) {
    throw new Error("Wallet RPC returned an invalid chain id");
  }
  return `0x${BigInt(value).toString(16)}`;
}

export class DAppConnectService {
  private connections = new Map<string, ActiveConnection>();
  private readonly ownership = new SessionOwnership();
  private dappLeaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Channels with an in-flight teardown, so concurrent disconnectSession()
  // calls for the same channel collapse to one run (the per-call guard alone
  // does not dedup across invocations). Value carries the effective `explicit`
  // so a racing user "forget" can upgrade a non-explicit teardown.
  private finalizing = new Map<
    string,
    {
      explicit: boolean;
      sendTerminate: boolean;
      requireTombstone: boolean;
      completion: Promise<void>;
      success: boolean;
    }
  >();
  // Consecutive post-handshake AEAD open failures per channel (desync detector).
  private decryptFailures = new Map<string, number>();
  private pendingRestrictedMethods = new Map<
    string,
    Map<string, PendingRestrictedRequestState>
  >();
  private reconnectInFlight: Promise<void> | null = null;
  private handlers: ServiceEventHandler | null = null;
  private walletEpoch = getWalletEpoch();
  private epochTeardown: Promise<void> = Promise.resolve();
  private readonly unsubscribeWalletEpoch: () => void;

  constructor() {
    this.unsubscribeWalletEpoch = subscribeWalletEpoch((epoch) => {
      this.handleWalletEpochAdvance(epoch);
    });
  }

  /** Release only the cross-tab listener; callers should disconnect first. */
  dispose(): void {
    this.unsubscribeWalletEpoch();
  }

  private isEpochCurrent(epoch: WalletEpoch): boolean {
    return epoch === this.walletEpoch && isWalletEpochCurrent(epoch);
  }

  private assertEpochCurrent(epoch: WalletEpoch): void {
    if (!this.isEpochCurrent(epoch)) {
      throw new Error("Wallet identity changed during QRL Connect operation");
    }
  }

  private handleWalletEpochAdvance(epoch: WalletEpoch): void {
    if (epoch === this.walletEpoch) return;
    this.walletEpoch = epoch;

    const staleChannels = Array.from(this.connections.entries())
      .filter(([, conn]) => conn.walletEpoch !== epoch)
      .map(([channelId, conn]) => {
        // Stop crypto and checkpoint work synchronously, before relay teardown
        // crosses its first await.
        conn.cryptoUsable = false;
        return channelId;
      });

    try {
      SessionStore.clearStale(epoch);
    } catch (error) {
      console.error(
        "[DAppConnect] Failed to clear sessions for newer wallet epoch:",
        error,
      );
    }

    this.epochTeardown = this.epochTeardown
      .catch(() => undefined)
      .then(async () => {
        await Promise.all(
          staleChannels.map((channelId) =>
            this.teardownSession(channelId, true, false, false, false),
          ),
        );
        this.handlers?.onSessionsChanged();
      });
  }

  setHandlers(handlers: ServiceEventHandler): void {
    this.handlers = handlers;
  }

  /**
   * Handle an incoming qrlconnect:// URI (from QR scan or deep link).
   * For v3: the URI carries a commitment and bearer capability; the wallet runs
   * Encaps → emits SYNACK → awaits ACK.
   */
  async handleConnectionURI(
    uri: string,
    origin: "qr" | "deeplink" = "qr",
  ): Promise<{ success: boolean; error?: string }> {
    const operationEpoch = this.walletEpoch;
    if (!this.isEpochCurrent(operationEpoch)) {
      return {
        success: false,
        error: "Wallet identity is changing; retry the connection",
      };
    }
    // A wake link is an intentional "foreground the wallet" signal from the
    // dApp SDK, not a pairing attempt: the session itself resumes via
    // reconnectAll (APP_STATE active fires before this URI is forwarded).
    // Recognize it so it does not read as a malformed pairing URI.
    const wakeCid = parseWakeURI(uri);
    if (wakeCid !== null) {
      dlog(
        `Wake link received (cid ${wakeCid}); sessions resume via reconnectAll`,
      );
      return { success: true };
    }

    let parsed;
    try {
      parsed = await parseConnectionURI(uri);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dlog(`URI parse failed: ${msg}`);
      return { success: false, error: msg };
    }
    try {
      if (!this.isEpochCurrent(operationEpoch)) {
        return {
          success: false,
          error: "Wallet identity changed while reading the connection",
        };
      }

      const channelId = cidToString(parsed.cid);

    const existingConn = this.connections.get(channelId);
    if (existingConn) {
      return this.duplicateConnectionResult(
        existingConn,
        parsed.fp,
        operationEpoch,
      );
    }

    if (!(await this.ownership.acquire(channelId))) {
      return {
        success: false,
        error:
          "This QRL Connect session is active in another wallet tab, or this browser cannot safely lock it",
      };
    }
    if (!this.isEpochCurrent(operationEpoch)) {
      this.ownership.release(channelId);
      return {
        success: false,
        error: "Wallet identity changed while opening the connection",
      };
    }

    // Another same-realm call can pass the pre-lock map check while this call
    // awaits ownership. Recheck under the origin-wide lock before installing
    // a connection so concurrent scans cannot overwrite each other's state.
    const racedConnection = this.connections.get(channelId);
    if (racedConnection) {
      return this.duplicateConnectionResult(
        racedConnection,
        parsed.fp,
        operationEpoch,
      );
    }

    // Real dApp info arrives in the first encrypted ORIGINATOR_INFO message;
    // show a placeholder until then. DAPP_CONNECTED is deferred until we
    // actually know who the dApp is.
    const placeholder: DAppInfo = { ...PENDING_DAPP_INFO };

    // PQP3 permits a non-default relay through an `r=<url>` query parameter.
    // The relay URL is outside the fingerprint-covered blob; a tampered relay can
    // only cause DoS, not break confidentiality (AEAD + transcript-bound
    // session key stand independent of the relay we connect to).
    const relayUrl = parsed.relayUrl || DEFAULT_RELAY_URL;
    const keyExchange = new KeyExchange(undefined, {
      onKeysExchanged: () => this.onKeysExchanged(channelId),
    });

    const socketClient = new SocketClient(relayUrl, {
      onMessage: (data) => {
        this.enqueueRelayMessage(channelId, data);
      },
      onConnected: () => {
        dlog(`Socket connected to relay for channel ${channelId}`);
      },
      onDisconnected: (reason) => {
        dlog(`Socket disconnected: ${reason}`);
        this.updateLiveSessionStatus(
          channelId,
          socketClient,
          SessionStatus.RECONNECTING,
        );
      },
      onReconnected: () => {
        dlog(`Socket reconnected for channel ${channelId}`);
        const conn = this.connections.get(channelId);
        if (!conn || conn.socketClient !== socketClient || !conn.cryptoUsable)
          return;
        if (conn.keyExchange.areKeysExchanged()) {
          this.updateLiveSessionStatus(
            channelId,
            socketClient,
            SessionStatus.CONNECTED,
          );
        } else {
          // Mid-handshake flap: our SYNACK may have died with the old
          // transport, or the dApp's ACK may have been delivered to the
          // dead socket. Re-send the cached SYNACK so both sides converge.
          this.resendPendingSynAck(channelId);
        }
      },
      onParticipantsChanged: (data) => {
        this.handleParticipantsChanged(channelId, data);
      },
      onTerminated: () => {
        // Auto-rejoin saw the channel tombstoned (dApp closed it). Tear down.
        void this.disconnectSession(channelId, false);
      },
    });

    const connection: ActiveConnection = {
      socketClient,
      keyExchange,
      dappInfo: placeholder,
      channelId,
      originatorInfoReceived: false,
      messageQueue: Promise.resolve(),
      persistenceQueue: Promise.resolve(),
      outboundQueue: Promise.resolve(),
      cryptoUsable: true,
      relayUrl,
      authorizedAccount: null,
      qrFingerprint: parsed.fp.slice(),
      originatedViaDeepLink: origin === "deeplink",
      walletEpoch: operationEpoch,
    };
    this.connections.set(channelId, connection);
    this.handlers?.onSessionsChanged();

    // v3 PQP3 protocol: the QR carries cid + fp + cap. We must join the
    // relay first to fetch the dApp's PK, verify it against fp, and only
    // then run Encaps. This is the "PK lives on the relay, fp pins it
    // cryptographically pinned" design.
    try {
      dlog(`Connecting to relay ${relayUrl} as wallet participant`);
      // connect() is async since the lazy socket.io-client import (perf
      // #153): it assigns this.socket only after the import resolves, so it
      // MUST be awaited or joinChannel races it and throws on a null socket.
      await socketClient.connect();
      this.assertEpochCurrent(operationEpoch);
      const joinResult = await socketClient.joinChannel(channelId);
      this.assertEpochCurrent(operationEpoch);
      const bufferedMessages = validateBufferedMessages(
        joinResult.bufferedMessages,
        channelId,
      );
      if (joinResult.terminated !== false) {
        throw new Error("Relay reported a terminated or malformed channel");
      }
      const channelPublicKey = joinResult.channelPublicKey;
      dlog(
        `joinChannel returned ${bufferedMessages.length} buffered msg(s), pk present: ${channelPublicKey !== null}`,
      );

      if (!channelPublicKey) {
        // dApp hasn't registered a PK yet (race), or relay forgot. For a
        // fresh scan the wallet has no existing session to fall back on,
        // so bail with a clear error — the user can rescan when the dApp
        // is actually live.
        throw new Error(
          "dApp has not registered its public key with the relay yet; retry the scan",
        );
      }

      const pk = decodeRelayPublicKey(channelPublicKey);
      const expectedFp = await computeFingerprint(parsed.cid, pk, parsed.cap);
      this.assertEpochCurrent(operationEpoch);
      if (!fingerprintEquals(parsed.fp, expectedFp)) {
        // The relay served a PK whose fingerprint doesn't match the QR.
        // Either a malicious relay is trying to MITM, or the QR is stale
        // and pointing at a channel rebound by a different dApp. Refuse.
        throw new Error(
          "Relay-provided public key does not match the fingerprint from the QR",
        );
      }
      const synack = await keyExchange.receiveQR(parsed.cid, pk, parsed.cap);
      this.assertEpochCurrent(operationEpoch);
      connection.pendingSynAck = synack;

      // Send SYNACK — this kicks off the visible portion of the handshake.
      await socketClient.sendMessage({
        id: channelId,
        clientType: "wallet",
        message: synack,
      });
      this.assertEpochCurrent(operationEpoch);

      for (const msg of bufferedMessages) {
        this.enqueueRelayMessage(channelId, msg);
      }

      return { success: true };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      dlog(`Connection failed: ${errMsg}`);
      // Tear the half-built connection down completely: without the
      // socketClient.disconnect() below, the underlying socket stays
      // joined to the relay channel and keeps firing onMessage handlers
      // for a channel whose ActiveConnection we've already dropped.
      try {
        await socketClient.leaveChannel();
      } catch {
        // ignore — we're already in the error path
      }
      socketClient.disconnect();
      if (this.connections.get(channelId) === connection) {
        this.connections.delete(channelId);
        try {
          SessionStore.remove(channelId, operationEpoch);
        } catch (removeErr) {
          console.error(
            "[DAppConnect] Failed to remove aborted session:",
            removeErr,
          );
        } finally {
          this.ownership.release(channelId);
        }
        this.handlers?.onSessionsChanged();
      }
      return { success: false, error: errMsg };
    }
    } finally {
      zeroize(parsed.cap);
    }
  }

  /**
   * Runs after the handshake completes (ACK verified).
   * Persists the session and emits WALLET_INFO; DAPP_CONNECTED is deferred
   * until ORIGINATOR_INFO populates the real dApp name/url.
   */
  private async onKeysExchanged(channelId: string): Promise<void> {
    dlog(`Keys exchanged for channel ${channelId}`);

    const conn = this.connections.get(channelId);
    if (!conn) return;
    conn.pendingSynAck = undefined;

    try {
      await this.persistSession(channelId, conn);
    } catch (err) {
      // persistSession already failed the connection closed. Do not emit
      // WALLET_INFO (or connected UI state) without a durable counter
      // checkpoint from which a reload can safely resume.
      console.error(
        "[DAppConnect] Failed to persist established session:",
        err,
      );
      return;
    }

    let walletChainId: string;
    try {
      walletChainId = await this.currentWalletChainId();
    } catch (err) {
      // The dApp supplies originatorInfo.chainId, so echoing that value would
      // let it choose the chain identity the wallet claims. Establish the
      // chain from the wallet's live provider or retire the pairing.
      console.error(
        "[DAppConnect] Could not establish the wallet chain id:",
        err,
      );
      await this.failClosedCryptoState(
        channelId,
        conn,
        "wallet chain id unavailable",
      );
      return;
    }

    const walletInfoSent = await this.sendEncrypted(channelId, {
      type: MessageType.WALLET_INFO,
      accounts: [],
      chainId: walletChainId,
    });
    if (!walletInfoSent || this.connections.get(channelId) !== conn) return;

    this.handlers?.onSessionConnected(channelId);
    this.handlers?.onSessionsChanged();
  }

  private async persistSession(
    channelId: string,
    expectedConnection?: ActiveConnection,
  ): Promise<void> {
    const conn = expectedConnection ?? this.connections.get(channelId);
    if (!conn) return;
    const task = conn.persistenceQueue.then(() =>
      this.persistSessionNow(channelId, conn),
    );
    conn.persistenceQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async persistSessionNow(
    channelId: string,
    conn: ActiveConnection,
  ): Promise<void> {
    const operationEpoch = conn.walletEpoch;
    try {
      this.assertEpochCurrent(operationEpoch);
      const persistedKex = await conn.keyExchange.exportPersisted();
      if (!persistedKex) {
        throw new Error(
          "Key exchange did not provide a persistence checkpoint",
        );
      }

      // exportPersisted() awaits WebCrypto. A disconnect timeout may have
      // finalized this connection in the meantime; never resurrect it by
      // writing a late checkpoint after SessionStore.remove().
      if (
        this.connections.get(channelId) !== conn ||
        !conn.cryptoUsable ||
        !this.isEpochCurrent(operationEpoch)
      ) {
        throw new Error(
          "Connection closed while checkpointing QRL Connect session",
        );
      }

      const existing = SessionStore.get(channelId);
      const authorizedAccount = conn.authorizedAccount;
      const session: DAppSession = {
        version: 4,
        id: channelId,
        dappInfo: conn.dappInfo,
        originatorInfoReceived: conn.originatorInfoReceived,
        accountAuthorized: authorizedAccount !== null,
        connectedAccount: authorizedAccount ?? "",
        keyExchange: persistedKex,
        relayUrl: conn.relayUrl,
        status: conn.keyExchange.areKeysExchanged()
          ? SessionStatus.CONNECTED
          : SessionStatus.KEY_EXCHANGE,
        createdAt: existing?.createdAt || Date.now(),
        lastActivity: Date.now(),
        walletEpoch: operationEpoch,
      };
      if (
        this.connections.get(channelId) !== conn ||
        !conn.cryptoUsable ||
        !this.isEpochCurrent(operationEpoch)
      ) {
        throw new Error(
          "Connection closed before writing QRL Connect checkpoint",
        );
      }
      SessionStore.save(session, operationEpoch);
    } catch (err) {
      if (this.connections.get(channelId) === conn) {
        await this.failClosedCryptoState(
          channelId,
          conn,
          "session checkpoint failed",
        );
      }
      throw err;
    }
  }

  private enqueueRelayMessage(channelId: string, data: RelayMessage): void {
    if (!isExpectedDappFrame(data, channelId)) return;
    const conn = this.connections.get(channelId);
    if (!conn || !conn.cryptoUsable || !this.isEpochCurrent(conn.walletEpoch))
      return;
    this.clearDappLeaveTimeout(channelId);
    // .catch keeps the queue alive: a single rejected handler (tag-fail,
    // bad JSON) must not starve every subsequent message on this channel.
    conn.messageQueue = conn.messageQueue
      .then(() => this.handleRelayMessage(channelId, data))
      .catch((err) =>
        dlog(
          `messageQueue error on ${channelId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  private async handleRelayMessage(
    channelId: string,
    data: RelayMessage,
  ): Promise<void> {
    const conn = this.connections.get(channelId);
    if (!conn || !conn.cryptoUsable || !this.isEpochCurrent(conn.walletEpoch)) {
      dlog(`handleRelayMessage: no connection for ${channelId}`);
      return;
    }

    const message = data.message;

    if (typeof message === "object" && message !== null) {
      const msg = message as { type?: string };
      if (msg.type === KeyExchangeMessageType.ACK) {
        try {
          await conn.keyExchange.onAck(message as AckMessage);
        } catch (err) {
          dlog(
            `ACK verify failed: ${err instanceof Error ? err.message : err}`,
          );
          // Await the teardown: the message queue is PER-CHANNEL, so
          // blocking this queue until the channel is fully torn down is
          // the correct behaviour on a security failure (prevents any
          // subsequent buffered message on this compromised channel from
          // being processed during the 800ms TERMINATE flush window).
          await this.disconnectSession(channelId, false).catch((err) =>
            console.error("[DAppConnect] disconnect-on-ack-fail failed:", err),
          );
        }
        return;
      }
      if (
        msg.type === KeyExchangeMessageType.SYN ||
        msg.type === KeyExchangeMessageType.SYNACK
      ) {
        dlog(`Unexpected ${msg.type} on wallet side — ignoring`);
        return;
      }
    }

    if (typeof message === "string" && conn.keyExchange.areKeysExchanged()) {
      // The failure counter is scoped STRICTLY to the AEAD open. JSON.parse
      // or dispatch errors happen after recvSeq advanced and say nothing
      // about stream health, so they must never count toward a teardown.
      let decrypted: string;
      try {
        decrypted = await conn.keyExchange.decryptMessage(message);
      } catch (err) {
        console.error("[DAppConnect] Failed to decrypt message:", err);
        const failures = (this.decryptFailures.get(channelId) ?? 0) + 1;
        this.decryptFailures.set(channelId, failures);
        if (failures >= MAX_DECRYPT_FAILURES) {
          dlog(`AEAD stream desynced on ${channelId}; terminating session`);
          // explicit=true tombstones the channel (close_channel): an
          // encrypted TERMINATE would be undecipherable to a desynced dApp.
          await this.teardownSession(channelId, true, false, true, false);
        }
        return;
      }
      this.decryptFailures.delete(channelId);

      // decryptMessage() advanced recvSeq. Persist that advanced counter
      // before JSON parsing or dispatching plaintext; otherwise a reload can
      // restore the old counter and accept this ciphertext as a replay.
      try {
        await this.persistSession(channelId, conn);
      } catch (err) {
        console.error(
          "[DAppConnect] Failed to checkpoint received message:",
          err,
        );
        return;
      }

      try {
        const parsed = JSON.parse(decrypted);
        await this.handleDecryptedMessage(channelId, parsed);
      } catch (err) {
        console.error("[DAppConnect] Failed to handle decrypted message:", err);
      }
    }
  }

  private async handleDecryptedMessage(
    channelId: string,
    msg: Record<string, unknown>,
  ): Promise<void> {
    const conn = this.connections.get(channelId);
    if (!conn) return;

    const type = msg["type"] as string;

    switch (type) {
      case MessageType.ORIGINATOR_INFO: {
        let info: DAppInfo;
        try {
          info = parseDAppInfo(msg["originatorInfo"]);
        } catch {
          await this.failClosedCryptoState(
            channelId,
            conn,
            "invalid dApp origin metadata",
          );
          return;
        }

        if (conn.originatorInfoReceived) {
          if (!dappInfoEquals(conn.dappInfo, info)) {
            // Identity and redirect are approval provenance. A peer must not
            // replace either after the user has seen or queued a request.
            await this.failClosedCryptoState(
              channelId,
              conn,
              "dApp origin metadata changed after being pinned",
            );
          }
          return;
        }

        conn.dappInfo = info;
        conn.originatorInfoReceived = true;
        await this.persistSession(channelId, conn);
        this.handlers?.onSessionsChanged();
        if (isInNativeApp() && conn.authorizedAccount) {
          sendToNative("DAPP_CONNECTED" as never, {
            name: conn.dappInfo.name,
            url: conn.dappInfo.url,
            channelId,
            connectedAccount: conn.authorizedAccount,
          });
          triggerHaptic("success");
        }
        break;
      }

      case MessageType.JSONRPC: {
        let request: ReturnType<typeof RequestHandler.validateJsonRpcEnvelope>;
        try {
          request = RequestHandler.validateJsonRpcEnvelope(msg);
        } catch {
          const id = msg["id"];
          if (RequestHandler.isValidJsonRpcId(id)) {
            await this.sendJsonRpcResponse(channelId, {
              jsonrpc: "2.0",
              id,
              error: { code: -32600, message: "Invalid JSON-RPC request" },
            });
          }
          return;
        }
        const { method, id, params } = request;

        if (!conn.originatorInfoReceived) {
          await this.sendJsonRpcResponse(channelId, {
            jsonrpc: "2.0",
            id,
            error: { code: 4100, message: "dApp identity is not established" },
          });
          return;
        }

        if (!RequestHandler.isKnownMethod(method)) {
          await this.sendJsonRpcResponse(channelId, {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          });
          return;
        }

        if (RequestHandler.isLocalRead(method)) {
          await this.sendJsonRpcResponse(channelId, {
            jsonrpc: "2.0",
            id,
            result: conn.authorizedAccount ? [conn.authorizedAccount] : [],
          });
          return;
        }

        if (RequestHandler.isRestricted(method)) {
          try {
            RequestHandler.validateRestrictedRequest(method, params);
          } catch (error) {
            await this.sendJsonRpcResponse(channelId, {
              jsonrpc: "2.0",
              id,
              error: {
                code: -32602,
                message:
                  error instanceof Error
                    ? error.message
                    : "Invalid method parameters",
              },
            });
            return;
          }

          if (ACCOUNT_BOUND_METHODS.has(method)) {
            const liveAccount = activeWalletAccount();
            const account = requestedAccount(method, params);
            if (
              conn.authorizedAccount === null ||
              liveAccount === null ||
              account === null ||
              !isExactQrlAccount(account, conn.authorizedAccount) ||
              !isExactQrlAccount(account, liveAccount)
            ) {
              await this.sendJsonRpcResponse(channelId, {
                jsonrpc: "2.0",
                id,
                error: {
                  code: 4100,
                  message: "Request is not authorized for this wallet account",
                },
              });
              return;
            }
          }

          const idKey = requestIdKey(id);
          let pending = this.pendingRestrictedMethods.get(channelId);
          if (!pending) {
            pending = new Map();
            this.pendingRestrictedMethods.set(channelId, pending);
          }
          if (pending.has(idKey)) {
            await this.sendJsonRpcResponse(channelId, {
              jsonrpc: "2.0",
              id,
              error: { code: -32600, message: "Duplicate pending JSON-RPC id" },
            });
            return;
          }
          pending.set(idKey, {
            method,
            authorizedAccount: ACCOUNT_BOUND_METHODS.has(method)
              ? conn.authorizedAccount
              : null,
          });
          const pendingRequest = RequestHandler.createPendingRequest(
            channelId,
            { method, params, id },
            conn.dappInfo,
          );
          this.handlers?.onPendingRequest(pendingRequest);

          if (isInNativeApp()) {
            sendToNative("DAPP_SHOW_WEBVIEW" as never, {
              name: conn.dappInfo.name,
              method,
            });
            triggerHaptic("warning");
          }
        } else {
          await this.proxyRpcRequest(channelId, id, method, params);
        }
        break;
      }

      case MessageType.TERMINATE: {
        // Await the teardown: the message queue is per-channel, so
        // halting it while we finalize this same channel is the correct
        // behaviour — any further buffered messages for a channel that's
        // being torn down are meaningless. explicit=false: a dApp-initiated
        // TERMINATE is a remote close (the dApp already left on its side), so
        // it should emit leave_channel and record a non-explicit disconnect,
        // matching the relay 'close' path — not a redundant durable tombstone.
        await this.disconnectSession(channelId, false).catch((err) =>
          console.error("[DAppConnect] disconnect-on-terminate failed:", err),
        );
        break;
      }

      default:
        console.log("[DAppConnect] Unhandled message type:", type);
    }
  }

  private async proxyRpcRequest(
    channelId: string,
    id: string | number,
    method: string,
    params?: unknown[],
  ): Promise<void> {
    try {
      const web3 = store.qrlStore.qrlInstance;
      if (!web3) throw new Error("Web3 not initialized");
      const provider = getRequestProvider(web3);
      if (!provider)
        throw new Error("Web3 provider does not support request()");

      const result = await provider.request({ method, params });
      await this.sendJsonRpcResponse(channelId, {
        jsonrpc: "2.0",
        id,
        result,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.sendJsonRpcResponse(channelId, {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: errMsg },
      });
    }
  }

  approveRequest(
    sessionId: string,
    requestId: string | number,
    result: unknown,
  ): void {
    void this.approveRequestInternal(sessionId, requestId, result).catch(
      (error) =>
        console.error("[DAppConnect] approval could not be completed:", error),
    );
  }

  private takePendingRestrictedRequest(
    sessionId: string,
    requestId: string | number,
  ): PendingRestrictedRequestState | undefined {
    const requests = this.pendingRestrictedMethods.get(sessionId);
    if (!requests) return undefined;
    const state = requests.get(requestIdKey(requestId));
    requests.delete(requestIdKey(requestId));
    if (requests.size === 0) this.pendingRestrictedMethods.delete(sessionId);
    return state;
  }

  private async currentWalletChainId(): Promise<string> {
    const web3 = store.qrlStore.qrlInstance;
    if (!web3) throw new Error("Web3 not initialized");
    const provider = getRequestProvider(web3);
    if (!provider) throw new Error("Web3 provider does not support request()");
    return canonicalChainId(
      await provider.request({ method: "qrl_chainId", params: [] }),
    );
  }

  private async approveRequestInternal(
    sessionId: string,
    requestId: string | number,
    result: unknown,
  ): Promise<void> {
    const pending = this.takePendingRestrictedRequest(sessionId, requestId);
    const conn = this.connections.get(sessionId);
    if (!pending || !conn?.cryptoUsable) return;

    if (ACCOUNT_BOUND_METHODS.has(pending.method)) {
      const liveAccount = activeWalletAccount();
      if (
        pending.authorizedAccount === null ||
        !isExactQrlAccount(conn.authorizedAccount, pending.authorizedAccount) ||
        !isExactQrlAccount(liveAccount, pending.authorizedAccount)
      ) {
        const sent = await this.sendJsonRpcResponse(sessionId, {
          jsonrpc: "2.0",
          id: requestId,
          error: {
            code: 4100,
            message: "Wallet account authorization changed before approval",
          },
        });
        if (sent) this.maybeReturnToDApp(sessionId);
        return;
      }
    }

    if (pending.method === "qrl_requestAccounts") {
      await this.approveAccountRequest(sessionId, requestId, result, conn);
      return;
    }

    // Send the response first, and only bounce back to the dApp once it was
    // actually transmitted. Native navigation can background and suspend the
    // wallet, so redirecting earlier could strand the dApp without a response.
    const sent = await this.sendJsonRpcResponse(sessionId, {
      jsonrpc: "2.0",
      id: requestId,
      result,
    });
    if (sent) {
      this.maybeReturnToDApp(sessionId);
      if (isInNativeApp()) triggerHaptic("success");
    } else {
      console.error(
        "[DAppConnect] approve response not sent; skipping return-to-dApp",
      );
    }
  }

  private async approveAccountRequest(
    sessionId: string,
    requestId: string | number,
    result: unknown,
    conn: ActiveConnection,
  ): Promise<void> {
    if (
      !Array.isArray(result) ||
      result.length !== 1 ||
      typeof result[0] !== "string" ||
      !Q_ADDRESS_PATTERN.test(result[0])
    ) {
      await this.sendJsonRpcResponse(sessionId, {
        jsonrpc: "2.0",
        id: requestId,
        error: { code: -32603, message: "Wallet produced an invalid account approval" },
      });
      return;
    }

    const approvedAccount = result[0] as string;
    const liveAccount = activeWalletAccount();
    if (!isExactQrlAccount(approvedAccount, liveAccount)) {
      await this.sendJsonRpcResponse(sessionId, {
        jsonrpc: "2.0",
        id: requestId,
        error: { code: 4100, message: "Approved account is no longer active" },
      });
      return;
    }

    let chainId: string;
    try {
      chainId = await this.currentWalletChainId();
    } catch {
      await this.sendJsonRpcResponse(sessionId, {
        jsonrpc: "2.0",
        id: requestId,
        error: { code: -32000, message: "Wallet chain id is unavailable" },
      });
      return;
    }

    if (this.connections.get(sessionId) !== conn || !conn.cryptoUsable) return;
    const previousAccount = conn.authorizedAccount;
    conn.authorizedAccount = approvedAccount;

    // Commit the consent binding before either WALLET_INFO or the JSON-RPC
    // response can disclose it. A failed checkpoint retires the session.
    await this.persistSession(sessionId, conn);
    if (this.connections.get(sessionId) !== conn || !conn.cryptoUsable) return;

    const walletInfoSent = await this.sendEncrypted(sessionId, {
      type: MessageType.WALLET_INFO,
      accounts: [approvedAccount],
      chainId,
    });
    if (!walletInfoSent || this.connections.get(sessionId) !== conn) return;

    if (
      approvedAccount !== previousAccount &&
      conn.originatorInfoReceived &&
      isInNativeApp()
    ) {
      sendToNative("DAPP_CONNECTED" as never, {
        name: conn.dappInfo.name,
        url: conn.dappInfo.url,
        channelId: sessionId,
        connectedAccount: approvedAccount,
      });
    }

    const responseSent = await this.sendJsonRpcResponse(sessionId, {
      jsonrpc: "2.0",
      id: requestId,
      result: [approvedAccount],
    });
    if (responseSent) {
      this.maybeReturnToDApp(sessionId);
      if (isInNativeApp()) triggerHaptic("success");
    }
  }

  rejectRequest(
    sessionId: string,
    requestId: string | number,
    message = "User rejected the request",
    // 4001 = user rejected (EIP-1193). Desktop passes 4902 (EIP-3326
    // unrecognized chain) for chain-switch requests it cannot honour
    // (single configured chain).
    code = 4001,
  ): void {
    const pending = this.takePendingRestrictedRequest(sessionId, requestId);
    if (!pending) return;
    void this.sendJsonRpcResponse(sessionId, {
      jsonrpc: "2.0",
      id: requestId,
      error: { code, message },
    }).then((sent) => {
      if (sent) this.maybeReturnToDApp(sessionId);
      else
        console.error(
          "[DAppConnect] reject response not sent; skipping return-to-dApp",
        );
    });
    if (isInNativeApp()) triggerHaptic("error");
  }

  /**
   * After resolving a restricted request, bounce the user back to the dApp
   * (WalletConnect-style peer redirect) if it advertised a return URL in
   * ORIGINATOR_INFO. Native opens the URL; on a same-device deep-link flow
   * this returns focus to the browser/dApp instead of stranding the user in
   * the wallet. No-op outside the native app or when no redirect was given.
   */
  private maybeReturnToDApp(channelId: string): void {
    if (!isInNativeApp()) return;
    const conn = this.connections.get(channelId);
    // Only bounce back for a same-device deep-link session. A QR-scanned
    // session means the dApp is on another device, so opening its URL on the
    // phone is wrong (e.g. a desktop dApp's http://localhost:5174).
    if (!conn?.originatedViaDeepLink) return;
    const redirectUrl = conn.dappInfo.redirectUrl;
    if (!redirectUrl) return;
    // The redirectUrl is attacker controlled. Only credential-free HTTP(S)
    // navigation may cross the native bridge, and the raw URL is never logged.
    const safeRedirectUrl = parseExternalHttpUrl(redirectUrl);
    if (safeRedirectUrl === null) {
      dlog("Ignoring unsafe dApp redirect URL");
      return;
    }
    sendToNative("DAPP_RETURN", { channelId, redirectUrl: safeRedirectUrl });
  }

  async disconnectSession(channelId: string, explicit = true): Promise<boolean> {
    if (
      !this.ownership.owns(channelId) &&
      !(await this.ownership.acquire(channelId))
    ) {
      dlog(
        `Cannot disconnect ${channelId}; another wallet tab owns QRL Connect`,
      );
      return false;
    }
    const active = this.connections.get(channelId);
    if (!active && explicit) {
      const stored = SessionStore.get(channelId);
      if (!stored) {
        this.ownership.release(channelId);
        return true;
      }
      const tombstoned = await this.tombstoneStoredSession(stored);
      if (!tombstoned) {
        this.ownership.release(channelId);
        return false;
      }
      try {
        SessionStore.remove(channelId, stored.walletEpoch ?? this.walletEpoch);
      } catch (error) {
        console.error("[DAppConnect] Failed to remove cold stored session:", error);
        this.ownership.release(channelId);
        return false;
      }
      this.ownership.release(channelId);
      this.handlers?.onSessionDisconnected(channelId);
      this.handlers?.onSessionsChanged();
      return true;
    }
    return this.teardownSession(channelId, explicit, true);
  }

  private async tombstoneStoredSession(session: DAppSession): Promise<boolean> {
    const socket = new SocketClient(session.relayUrl || DEFAULT_RELAY_URL, {
      onMessage: () => undefined,
      onConnected: () => undefined,
      onDisconnected: () => undefined,
      onReconnected: () => undefined,
      onParticipantsChanged: () => undefined,
      onTerminated: () => undefined,
    });
    try {
      await socket.connect();
      const joined = await socket.joinChannel(session.id);
      if (joined.terminated) return true;
      return await socket.closeChannel();
    } catch (error) {
      console.error("[DAppConnect] Could not tombstone stored session:", error);
      return false;
    } finally {
      socket.disconnect();
    }
  }

  private async teardownSession(
    channelId: string,
    explicit: boolean,
    sendTerminate: boolean,
    awaitInflight = true,
    requireTombstone = explicit,
  ): Promise<boolean> {
    dlog(`disconnectSession called for ${channelId}`);
    this.clearDappLeaveTimeout(channelId);
    this.decryptFailures.delete(channelId);
    this.pendingRestrictedMethods.delete(channelId);

    // Collapse concurrent teardowns of the same channel to a single run. A
    // per-call flag cannot do this (each invocation has its own), so a user
    // tap racing an inbound TERMINATE / relay 'close' / grace timeout would
    // otherwise each reach finalize and fire DAPP_DISCONNECTED +
    // onSessionDisconnected twice (CLAUDE.md 4.6), with a conflicting
    // `explicit` that corrupts the persisted flag. First caller wins; a later
    // explicit=true upgrades the shared decision so a user "forget" still
    // produces the durable tombstone rather than a transient leave.
    const inflight = this.finalizing.get(channelId);
    if (inflight) {
      if (explicit) inflight.explicit = true;
      if (!sendTerminate) inflight.sendTerminate = false;
      if (requireTombstone) inflight.requireTombstone = true;
      if (awaitInflight) await inflight.completion;
      return inflight.success;
    }
    let resolveCompletion: () => void = () => undefined;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const teardown = {
      explicit,
      sendTerminate,
      requireTombstone,
      completion,
      success: false,
    };
    this.finalizing.set(channelId, teardown);

    const conn = this.connections.get(channelId);

    let finalized = false;
    const finalize = async (): Promise<boolean> => {
      if (finalized) return teardown.success;
      finalized = true;

      const activeConn = this.connections.get(channelId);
      const storageEpoch =
        activeConn?.walletEpoch ?? conn?.walletEpoch ?? this.walletEpoch;
      if (activeConn) {
        activeConn.cryptoUsable = false;
        // An explicit disconnect ("forget" / user-initiated) marks a durable
        // relay tombstone so an absent dApp learns the session is dead on its
        // next join; a grace-timeout leave is transient and must not. Await the
        // flush before disconnect() so the close/leave packet actually reaches
        // the relay instead of being dropped with the torn-down socket.
        let tombstoneConfirmed = false;
        try {
          if (teardown.explicit) {
            tombstoneConfirmed = await activeConn.socketClient.closeChannel();
          } else {
            await activeConn.socketClient.leaveChannel();
            // A user/native forget can race a remote/grace teardown while the
            // leave acknowledgement is pending. Upgrade to a close using the
            // captured channel id so that request cannot be downgraded.
            if (teardown.explicit) {
              tombstoneConfirmed = await activeConn.socketClient.closeChannel(
                channelId,
              );
            }
          }
        } catch (err) {
          console.error("[DAppConnect] Failed to close relay channel:", err);
        } finally {
          if (this.connections.get(channelId) === activeConn) {
            this.connections.delete(channelId);
          }
          try {
            activeConn.socketClient.disconnect();
          } catch (err) {
            console.error(
              "[DAppConnect] Failed to disconnect relay socket:",
              err,
            );
          }
        }
        if (teardown.requireTombstone && !tombstoneConfirmed) {
          this.ownership.release(channelId);
          this.handlers?.onSessionsChanged();
          teardown.success = false;
          return false;
        }
      }

      try {
        SessionStore.remove(channelId, storageEpoch);
        teardown.success = true;
      } catch (err) {
        // The relay tombstone plus the in-memory removal still fail closed.
        // A later reconnect that can read storage observes the tombstone and
        // drops any stale local record instead of resuming its counters.
        console.error("[DAppConnect] Failed to remove persisted session:", err);
        teardown.success = false;
      }
      this.ownership.release(channelId);
      this.handlers?.onSessionDisconnected(channelId);
      this.handlers?.onSessionsChanged();

      if (isInNativeApp()) {
        sendToNative("DAPP_DISCONNECTED" as never, {
          channelId,
          explicit: teardown.explicit,
        });
      }
      return teardown.success;
    };

    try {
      // Only attempt the encrypted TERMINATE when there's a live, keyed
      // session and crypto state is still durable. TERMINATE uses the same
      // outbound encrypt/checkpoint/send queue as every other ciphertext.
      if (
        conn &&
        teardown.sendTerminate &&
        conn.cryptoUsable &&
        conn.keyExchange.areKeysExchanged()
      ) {
        await Promise.race([
          this.sendEncrypted(channelId, { type: MessageType.TERMINATE }),
          new Promise((resolve) =>
            setTimeout(resolve, TERMINATE_SEND_TIMEOUT_MS),
          ),
        ]);
      }
    } finally {
      // Always release the in-flight guard, even if finalize() throws (e.g. a
      // handler raises): otherwise a stuck `finalizing` entry would make every
      // later disconnectSession(channelId) early-return and permanently block
      // that channel's teardown for the page lifetime.
      try {
        await finalize();
      } finally {
        this.finalizing.delete(channelId);
        resolveCompletion();
      }
    }
    return teardown.success;
  }

  getActiveSessions(): DAppSession[] {
    return SessionStore.getAll();
  }

  /**
   * Reconnect all stored sessions (called on app launch / foreground).
   */
  reconnectAll(): Promise<void> {
    this.reconnectInFlight ??= this.reconnectStoredSessions().finally(() => {
      this.reconnectInFlight = null;
    });
    return this.reconnectInFlight;
  }

  private async reconnectStoredSessions(): Promise<void> {
    dlog(`reconnectAll called`);
    const operationEpoch = this.walletEpoch;
    if (!this.isEpochCurrent(operationEpoch)) return;
    for (const channelId of this.dappLeaveTimers.keys()) {
      this.clearDappLeaveTimeout(channelId);
    }
    if (!(await this.ownership.acquire(STORE_MAINTENANCE_CHANNEL))) {
      dlog(
        "Skipping session migration/reconnect; another wallet tab owns QRL Connect",
      );
      this.handlers?.onSessionsChanged();
      return;
    }

    try {
      this.assertEpochCurrent(operationEpoch);
      // Physical deletion happens only while this tab holds the global lock.
      // This removes pre-PQP3 raw-key records even when there are no v4 sessions,
      // while getAll() remains a safe, side-effect-free UI read.
      SessionStore.prune(operationEpoch);
      const sessions = SessionStore.getAll();
      for (const session of sessions) {
        this.assertEpochCurrent(operationEpoch);
        if (this.connections.has(session.id)) continue;

        if (!(await this.ownership.acquire(session.id))) {
          dlog(
            `Skipping stored session ${session.id}; another wallet tab owns it`,
          );
          continue;
        }

        try {
          this.assertEpochCurrent(operationEpoch);
          const restored = await KeyExchange.sessionFromPersisted(
            session.keyExchange,
          );
          this.assertEpochCurrent(operationEpoch);
          const keyExchange = new KeyExchange(restored, {
            onKeysExchanged: () => this.onKeysExchanged(session.id),
          });

          const reconnectRelayUrl = session.relayUrl || DEFAULT_RELAY_URL;
          const socketClient = new SocketClient(reconnectRelayUrl, {
            onMessage: (data) => {
              this.enqueueRelayMessage(session.id, data);
            },
            onConnected: () =>
              dlog(`Reconnected to relay for ${session.dappInfo.name}`),
            onDisconnected: () => {
              this.updateLiveSessionStatus(
                session.id,
                socketClient,
                SessionStatus.RECONNECTING,
              );
            },
            onReconnected: () => {
              if (keyExchange.areKeysExchanged()) {
                this.updateLiveSessionStatus(
                  session.id,
                  socketClient,
                  SessionStatus.CONNECTED,
                );
              }
            },
            onParticipantsChanged: (data) => {
              this.handleParticipantsChanged(session.id, data);
            },
            onTerminated: () => {
              // The dApp closed the channel while we were transiently away
              // (auto-rejoin saw the tombstone). Drop the dead session.
              void this.disconnectSession(session.id, false);
            },
          });

          this.connections.set(session.id, {
            socketClient,
            keyExchange,
            dappInfo: session.dappInfo,
            channelId: session.id,
            originatorInfoReceived: session.originatorInfoReceived,
            messageQueue: Promise.resolve(),
            persistenceQueue: Promise.resolve(),
            outboundQueue: Promise.resolve(),
            cryptoUsable: true,
            relayUrl: reconnectRelayUrl,
            authorizedAccount: session.accountAuthorized
              ? session.connectedAccount
              : null,
            // The connect origin isn't persisted, so a rehydrated session does
            // not auto-redirect. Safe default: a wrong-device redirect never
            // fires; a fresh same-device deep-link approval still does.
            originatedViaDeepLink: false,
            walletEpoch: operationEpoch,
          });

          // Same as the fresh-scan path: connect() resolves only after the
          // lazy socket.io-client import assigns this.socket; await it before
          // joinChannel.
          await socketClient.connect();
          this.assertEpochCurrent(operationEpoch);
          const joinResult = await socketClient.joinChannel(session.id);
          this.assertEpochCurrent(operationEpoch);
          const bufferedMessages = validateBufferedMessages(
            joinResult.bufferedMessages,
            session.id,
          );
          const { terminated } = joinResult;

          if (terminated !== false) {
            // The dApp explicitly closed this channel while the wallet was
            // offline. Drop the dead session instead of resurrecting a ghost
            // that shows active but can never reach the gone dApp.
            dlog(
              `Stored session ${session.id} was terminated by the dApp; dropping`,
            );
            socketClient.disconnect();
            this.connections.delete(session.id);
            try {
              SessionStore.remove(session.id, operationEpoch);
            } finally {
              this.ownership.release(session.id);
            }
            this.handlers?.onSessionDisconnected(session.id);
            continue;
          }

          for (const msg of bufferedMessages) {
            this.enqueueRelayMessage(session.id, msg);
          }

          if (keyExchange.areKeysExchanged()) {
            SessionStore.updateStatus(
              session.id,
              SessionStatus.CONNECTED,
              operationEpoch,
            );
          }
        } catch (err) {
          console.error(
            "[DAppConnect] Failed to reconnect session:",
            session.id,
            err,
          );
          // The connection was added to this.connections before the join; if the
          // join failed (e.g. transient network), tear it down so a later
          // reconnectAll can retry. Left in place it would be skipped on every
          // retry (has() is true) and never auto-rejoin (hasJoinedOnce is false).
          const failed = this.connections.get(session.id);
          if (failed) {
            failed.socketClient.disconnect();
            this.connections.delete(session.id);
          }
          try {
            if (this.isEpochCurrent(operationEpoch)) {
              SessionStore.updateStatus(
                session.id,
                SessionStatus.DISCONNECTED,
                operationEpoch,
              );
            }
          } catch (statusErr) {
            console.error(
              "[DAppConnect] Failed to persist reconnect status:",
              statusErr,
            );
          } finally {
            this.ownership.release(session.id);
          }
        }
      }
    } catch (err) {
      console.error("[DAppConnect] Failed to prune persisted sessions:", err);
    } finally {
      this.ownership.release(STORE_MAINTENANCE_CHANNEL);
      this.handlers?.onSessionsChanged();
    }
  }

  async disconnectAll(): Promise<void> {
    dlog(`disconnectAll called with ${this.connections.size} connections`);
    // Snapshot before awaiting — disconnectSession mutates the map.
    const channelIds = Array.from(this.connections.keys());
    const results = await Promise.all(
      channelIds.map((cid) => this.disconnectSession(cid)),
    );
    if (results.some((success) => !success)) {
      throw new Error("One or more QRL Connect sessions could not be removed");
    }
  }

  /** End every pairing and invalidate live copies in every same-origin tab. */
  async clearAllSessions(advanceEpoch = true): Promise<void> {
    const clearEpoch = advanceEpoch ? advanceWalletEpoch() : this.walletEpoch;
    try {
      await this.disconnectAll();
      await this.epochTeardown;
    } finally {
      SessionStore.clearStale(clearEpoch);
      this.handlers?.onSessionsChanged();
    }
  }

  static isConnectionURI(uri: string): boolean {
    if (
      typeof uri !== "string" ||
      uri.length === 0 ||
      uri.length > MAX_CONNECTION_URI_LENGTH ||
      uri.trim() !== uri ||
      !/^qrlconnect:\/\/\?/i.test(uri)
    ) {
      return false;
    }
    try {
      const swapped = new URL(
        uri.replace(/^qrlconnect:\/\//i, "https://qrlconnect/"),
      );
      if (swapped.pathname !== "/" || swapped.hash !== "") return false;
      const params = swapped.searchParams;
      if ([...params.keys()].some((key) => !["q", "r", "wake"].includes(key))) {
        return false;
      }
      const q = params.getAll("q");
      const wake = params.getAll("wake");
      const relay = params.getAll("r");
      if (relay.length > 1) return false;
      if (relay.length === 1) {
        try {
          parseRelayUrl(relay[0] ?? "");
        } catch {
          return false;
        }
      }
      if (q.length === 1 && wake.length === 0) return q[0]?.length !== 0;
      return (
        q.length === 0 &&
        wake.length === 1 &&
        relay.length === 0 &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          wake[0] ?? "",
        )
      );
    } catch {
      return false;
    }
  }

  // ── Private helpers ──

  private duplicateConnectionResult(
    connection: ActiveConnection,
    fingerprint: Uint8Array,
    operationEpoch: WalletEpoch,
  ): { success: boolean; error?: string } {
    if (
      connection.walletEpoch !== operationEpoch ||
      !connection.cryptoUsable
    ) {
      return {
        success: false,
        error: "Previous wallet connection is still being cleared",
      };
    }
    // Compare the exact original commitment. Recomputing from a newly scanned
    // cap would accept an attacker-selected cap and its matching fingerprint.
    if (
      !connection.qrFingerprint ||
      !fingerprintEquals(fingerprint, connection.qrFingerprint)
    ) {
      return {
        success: false,
        error:
          "Scanned QR does not match the already-connected dApp for this channel",
      };
    }
    return { success: true };
  }

  private updateLiveSessionStatus(
    channelId: string,
    socketClient: SocketClient,
    status: SessionStatus,
  ): void {
    const conn = this.connections.get(channelId);
    if (!conn || conn.socketClient !== socketClient || !conn.cryptoUsable)
      return;
    try {
      SessionStore.updateStatus(channelId, status, conn.walletEpoch);
      this.handlers?.onSessionsChanged();
    } catch (err) {
      console.error(
        "[DAppConnect] Failed to persist live session status:",
        err,
      );
      void this.failClosedCryptoState(
        channelId,
        conn,
        "session status persistence failed",
      );
    }
  }

  private handleParticipantsChanged(
    channelId: string,
    data: { event: string; clientType?: string },
  ): void {
    dlog(
      `Participants changed: ${data.event} (${data.clientType || "unknown"})`,
    );

    // The dApp (or relay) explicitly terminated the channel via close_channel.
    // This is durable, not a transient backgrounding leave, so tear down now
    // instead of arming the rejoin grace, otherwise the session lingers as a
    // ghost (shown active) until the socket drops or the channel TTL expires.
    // explicit=false makes teardown emit leave_channel rather than
    // close_channel, so we do not bounce a redundant close back to the relay.
    if (data.event === "close") {
      this.clearDappLeaveTimeout(channelId);
      void this.disconnectSession(channelId, false);
      return;
    }

    if (data.event === "join" && data.clientType === "dapp") {
      this.clearDappLeaveTimeout(channelId);
      // If the handshake is still open, the (re)joining dApp may have
      // missed our SYNACK; re-send it (idempotent on the dApp side).
      this.resendPendingSynAck(channelId);
      return;
    }

    if (
      (data.event === "disconnect" || data.event === "leave") &&
      (data.clientType === "dapp" || !data.clientType)
    ) {
      const conn = this.connections.get(channelId);
      if (!conn) return;
      if (!conn.keyExchange.areKeysExchanged() && data.event === "leave") {
        // The dApp DELIBERATELY left (leave_channel) before the handshake
        // completed. There is no established session to grace-hold, and an
        // encrypted TERMINATE from the dApp is undecryptable pre-handshake,
        // so this is the only disconnect signal we will ever get. Fail
        // closed now; it also stops a later relay-buffered ACK completing
        // the handshake into a ghost CONNECTED session.
        dlog(`dApp left before handshake completed; tearing down ${channelId}`);
        void this.disconnectSession(channelId, false);
        return;
      }
      // Transient pre-handshake socket drop ('disconnect') gets the normal
      // grace: the dApp's auto-reconnect re-joins, we retransmit the cached
      // SYNACK, and the handshake converges. The grace timer still bounds a
      // late-buffered-ACK ghost if the dApp never returns.
      this.scheduleDappLeaveTimeout(channelId);
    }
  }

  /**
   * Re-send the cached SYNACK for a handshake that has not completed.
   * Safe to call repeatedly: the bytes are deterministic, the dApp ignores
   * duplicates after completing (or answers with its cached ACK), and we
   * stop once keys are exchanged.
   */
  private resendPendingSynAck(channelId: string): void {
    const conn = this.connections.get(channelId);
    if (!conn || conn.keyExchange.areKeysExchanged() || !conn.pendingSynAck)
      return;
    dlog(`Re-sending SYNACK for incomplete handshake on ${channelId}`);
    void conn.socketClient
      .sendMessage({
        id: channelId,
        clientType: "wallet",
        message: conn.pendingSynAck,
      })
      .catch((err: unknown) => {
        dlog(
          `SYNACK re-send failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  private scheduleDappLeaveTimeout(
    channelId: string,
    graceStartedAt = Date.now(),
  ): void {
    this.clearDappLeaveTimeout(channelId);
    const timeout = setTimeout(() => {
      this.dappLeaveTimers.delete(channelId);
      if (!this.connections.has(channelId)) return;
      // Don't reap a session whose approval modal the user is still looking
      // at: FaceID + reading a request routinely outlasts one grace period,
      // and the eventual response is relay-buffered for the absent dApp
      // either way. Re-arm instead, bounded by the cumulative cap.
      if (
        Date.now() - graceStartedAt < DAPP_LEAVE_APPROVAL_CAP_MS &&
        this.handlers?.hasPendingApprovalsForChannel?.(channelId)
      ) {
        dlog(
          `dApp absent but approval pending for ${channelId}; extending grace`,
        );
        this.scheduleDappLeaveTimeout(channelId, graceStartedAt);
        return;
      }
      dlog(`dApp absent for ${DAPP_REJOIN_GRACE_MS}ms; disconnecting`);
      // Fire-and-forget: this is a setTimeout callback, nothing to await into.
      void this.disconnectSession(channelId, false);
    }, DAPP_REJOIN_GRACE_MS);
    this.dappLeaveTimers.set(channelId, timeout);
    dlog(`Scheduled stale-session timeout for channel ${channelId}`);
  }

  private clearDappLeaveTimeout(channelId: string): void {
    const timeout = this.dappLeaveTimers.get(channelId);
    if (timeout) {
      clearTimeout(timeout);
      this.dappLeaveTimers.delete(channelId);
      dlog(`Cleared stale-session timeout for channel ${channelId}`);
    }
  }

  /**
   * Encrypt + send a message to the dApp. Resolves true if it was actually
   * transmitted, false if there was no connection or the send failed. The
   * boolean lets callers (approve/reject) gate the return-to-dApp redirect on
   * a real successful send rather than assuming success.
   */
  private sendEncrypted(channelId: string, message: object): Promise<boolean> {
    const conn = this.connections.get(channelId);
    if (!conn?.cryptoUsable) return Promise.resolve(false);

    const task = conn.outboundQueue.then(() =>
      this.sendEncryptedNow(channelId, message, conn),
    );
    // Keep the per-channel queue alive after a failed task while still
    // propagating that failure to this caller as `false` below.
    conn.outboundQueue = task.then(
      () => undefined,
      () => undefined,
    );

    return task.then(
      () => true,
      (err: unknown) => {
        console.error("[DAppConnect] Failed to send encrypted:", err);
        return false;
      },
    );
  }

  private async sendEncryptedNow(
    channelId: string,
    message: object,
    conn: ActiveConnection,
  ): Promise<void> {
    if (this.connections.get(channelId) !== conn || !conn.cryptoUsable) {
      throw new Error("sendEncrypted: connection is no longer active");
    }

    // Stringify before reserving a nonce, so a malformed/cyclic local object
    // cannot consume a counter without producing a ciphertext.
    const plaintext = JSON.stringify(message);
    let encrypted: string;
    try {
      encrypted = await conn.keyExchange.encryptMessage(plaintext);
    } catch (err) {
      // encryptMessage reserves sendSeq before awaiting WebCrypto. Any error
      // after that reservation makes the live/persisted stream relationship
      // ambiguous, so retire the session rather than trying another nonce.
      await this.failClosedCryptoState(
        channelId,
        conn,
        "message encryption failed",
      );
      throw err;
    }

    if (this.connections.get(channelId) !== conn || !conn.cryptoUsable) {
      throw new Error("sendEncrypted: connection closed during encryption");
    }

    // The counter is already advanced. Persist it BEFORE exposing the
    // ciphertext to the relay; a crash may then leave storage ahead (which
    // fails closed), but can never restore behind and reuse this nonce.
    await this.persistSession(channelId, conn);

    if (this.connections.get(channelId) !== conn || !conn.cryptoUsable) {
      throw new Error("sendEncrypted: connection closed after checkpoint");
    }

    try {
      await conn.socketClient.sendMessage({
        id: channelId,
        clientType: "wallet",
        message: encrypted,
      });
    } catch (err) {
      // A rejected/missing relay acknowledgement is ambiguous: the relay may
      // have accepted this counter even though the wallet did not observe the
      // ack. Retrying or sending the next counter risks nonce reuse or a
      // permanent gap, so tombstone the session and require a fresh pairing.
      await this.failClosedCryptoState(
        channelId,
        conn,
        "relay send outcome unknown",
      );
      throw err;
    }
  }

  private async failClosedCryptoState(
    channelId: string,
    conn: ActiveConnection,
    reason: string,
  ): Promise<void> {
    if (this.connections.get(channelId) !== conn) return;
    conn.cryptoUsable = false;
    dlog(`Failing closed for ${channelId}: ${reason}`);
    // Do not attempt an encrypted TERMINATE: the durable counter state is
    // unknown. A relay tombstone communicates permanent teardown without
    // consuming another AEAD nonce.
    await this.teardownSession(channelId, true, false, false, false).catch(
      (err) =>
        console.error("[DAppConnect] Fail-closed teardown failed:", err),
    );
  }

  private sendJsonRpcResponse(
    channelId: string,
    response: JsonRpcResponse,
  ): Promise<boolean> {
    return this.sendEncrypted(channelId, {
      type: MessageType.JSONRPC,
      ...response,
    });
  }
}

// Singleton
export const dappConnectService = new DAppConnectService();
