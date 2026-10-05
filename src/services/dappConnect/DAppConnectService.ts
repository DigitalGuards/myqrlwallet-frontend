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
import { SocketClient, SocketNotConnectedError } from "./SocketClient";
import { RequestHandler } from "./RequestHandler";
import { getRequestProvider, readWalletChainId } from "./rpcProvider";
import {
  isExactQrlAccount,
  isQrlAccount,
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

/**
 * How long a message held for an unreachable relay stays worth sending.
 *
 * The SDK rejects a pending request after five minutes and the relay buffers
 * for the same window, so a later delivery would answer a promise nobody is
 * holding any more.
 */
const OFFLINE_OUTBOX_TTL_MS = 5 * 60 * 1000;

/** Per channel. A wallet answering more than this while offline is a bug. */
const OFFLINE_OUTBOX_LIMIT = 16;

/** Slowest cadence at which coming online or returning to the tab may retry. */
const WAKE_RETRY_MIN_INTERVAL_MS = 30_000;
const TERMINATE_SEND_TIMEOUT_MS = 800;
import { profileStorageKey } from '@/config/runtimeProfile';

const SESSION_LOCK_NAME = profileStorageKey("qrlconnect:wallet-owner");
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
  return isQrlAccount(address)
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

/** A message held as plaintext, with the moment it was first queued. */
interface OfflineOutboxEntry {
  message: object;
  queuedAt: number;
  /** An answer to a dApp request. Never evicted to make room. */
  isAnswer: boolean;
}

/** A sealed frame, kept verbatim for retransmission. */
interface RelayFrame {
  encrypted: string;
}

/**
 * This call's message was sealed and then parked for retransmission.
 *
 * Distinct from SocketNotConnectedError, which means nothing was sealed. The
 * difference decides whether the plaintext should also be queued: doing both
 * delivers the same message twice.
 */
class FrameParkedError extends Error {
  constructor() {
    super("relay frame parked for retransmission");
    this.name = "FrameParkedError";
  }
}

/**
 * What became of a send.
 *
 * `held` is the one that matters: the message is queued for delivery when the
 * relay returns, so a caller must carry on rather than treat it as a failure.
 * The old boolean collapsed `held` and `failed` together, which silently left
 * an approved qrl_requestAccounts unanswered.
 */
export type SendOutcome = "sent" | "held" | "failed";


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
  /**
   * Plaintext waiting for the relay to come back. Lives on the connection, so
   * it dies with it: a message queued for one connection can never be
   * delivered through a later one restored for the same channel.
   */
  offlineOutbox: OfflineOutboxEntry[];
  /** One flusher at a time; two reconnect events must not race the queue. */
  flushing: boolean;
  /**
   * One sealed frame whose socket died between the checkpoint and the send.
   * Its counter is already spent and checkpointed, so it must go out first and
   * unchanged when the relay returns. Re-sending identical bytes under the
   * same counter reuses no nonce.
   */
  pendingRetransmit: RelayFrame | null;
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
   * The answer reached the dApp and the app was asked to hand the user back.
   *
   * Only then, so the UI never tells a user to go back to a dApp that is still
   * waiting: an answer held for an absent relay reaches it later, or not at
   * all. Optional, so existing wirings and mocks stay valid.
   */
  onReturnHandedBack?: (channelId: string) => void;
  /**
   * Whether an approval for this channel is still waiting on the user.
   * Optional so existing wirings/mocks stay valid; when absent the
   * stale-session grace behaves as before (no approval-aware extension).
   */
  hasPendingApprovalsForChannel?: (channelId: string) => boolean;
};

interface PendingRestrictedRequestState {
  method: string;
  /** Authorization snapshot captured when an account-bound request entered. */
  authorizedAccount: string | null;
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
  private readonly unbindWakeRetry: () => void;
  private lastWakeRetryAt = 0;

  constructor() {
    this.unsubscribeWalletEpoch = subscribeWalletEpoch((epoch) => {
      this.handleWalletEpochAdvance(epoch);
    });
    this.unbindWakeRetry = this.bindWakeRetry();
  }

  /** Release only the cross-tab listener; callers should disconnect first. */
  dispose(): void {
    this.unsubscribeWalletEpoch();
    this.unbindWakeRetry();
  }

  /**
   * Retry stored sessions that have no live connection when the machine wakes.
   *
   * A session kept after the relay refused reconnection otherwise waits for a
   * reload, which on desktop and on a pinned browser tab can be days. Coming
   * back online and returning to the tab are the two moments that refusal is
   * most likely over. Rate limited, and skipped while every stored session is
   * already live, so a tab switch costs nothing in the normal case.
   */
  private bindWakeRetry(): () => void {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return () => undefined;
    }
    const retry = (): void => {
      if (document.visibilityState === "hidden") return;
      const offline = SessionStore.getAll().some(
        (session) => !this.connections.has(session.id),
      );
      if (!offline) return;
      const now = Date.now();
      if (now - this.lastWakeRetryAt < WAKE_RETRY_MIN_INTERVAL_MS) return;
      this.lastWakeRetryAt = now;
      void this.reconnectAll().catch((err: unknown) =>
        console.error("[DAppConnect] wake retry failed:", err),
      );
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
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
      onReconnectAbandoned: () => {
        this.handleReconnectAbandoned(channelId);
      },
      onRejoinAbandoned: () => {
        this.handleReconnectAbandoned(channelId);
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
          this.flushOfflineOutbox(channelId);
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
      offlineOutbox: [],
      flushing: false,
      pendingRetransmit: null,
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

    const walletInfo = await this.sendEncrypted(channelId, {
      type: MessageType.WALLET_INFO,
      accounts: [],
      chainId: walletChainId,
    });
    // Held is progress: the dApp gets this when the relay returns.
    if (walletInfo === "failed" || this.connections.get(channelId) !== conn) return;

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
          try {
            RequestHandler.validateUnrestrictedRequest(method, params);
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
    return readWalletChainId(store.qrlStore.qrlInstance);
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
        if (sent === "sent") this.maybeReturnToDApp(sessionId);
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
    if (sent === "sent") {
      this.maybeReturnToDApp(sessionId);
      if (isInNativeApp()) triggerHaptic("success");
    } else if (sent === "held") {
      // The relay is away; the answer goes out when it returns. Bouncing the
      // user back to a dApp that has nothing yet would only confuse them.
      dlog("Approve response held for reconnect; skipping return-to-dApp");
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
      !isQrlAccount(result[0])
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

    // Carry on when the relay is merely away: WALLET_INFO is queued and the
    // response below queues behind it, so the dApp gets both in order when it
    // returns. Stopping here left an approved connect request unanswered for
    // good, and native never saw DAPP_CONNECTED.
    const walletInfo = await this.sendEncrypted(sessionId, {
      type: MessageType.WALLET_INFO,
      accounts: [approvedAccount],
      chainId,
    });
    if (walletInfo === "failed" || this.connections.get(sessionId) !== conn) return;

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

    const response = await this.sendJsonRpcResponse(sessionId, {
      jsonrpc: "2.0",
      id: requestId,
      result: [approvedAccount],
    });
    // Only bounce the user back to a dApp that actually has the answer.
    if (response === "sent") {
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
      if (sent === "sent") this.maybeReturnToDApp(sessionId);
      else if (sent === "held")
        dlog("Reject response held for reconnect; skipping return-to-dApp");
      else
        console.error(
          "[DAppConnect] reject response not sent; skipping return-to-dApp",
        );
    });
    if (isInNativeApp()) triggerHaptic("error");
  }

  private resolveReturnTarget(channelId: string): string | null {
    if (!isInNativeApp()) return null;
    const conn = this.connections.get(channelId);
    // Only bounce back for a same-device deep-link session. A QR-scanned
    // session means the dApp is on another device, so opening its URL on the
    // phone is wrong (e.g. a desktop dApp's http://localhost:5174).
    if (!conn?.originatedViaDeepLink) return null;
    const redirectUrl = conn.dappInfo.redirectUrl;
    if (!redirectUrl) return null;
    // The redirectUrl is attacker controlled. Only credential-free HTTP(S)
    // navigation may cross the native bridge, and the raw URL is never logged.
    // Silent: the UI asks this on every render, and the diagnostic belongs at
    // the one place where a hand-back was actually due.
    return parseExternalHttpUrl(redirectUrl);
  }

  /**
   * Hand the user back to the dApp after their request was answered.
   *
   * Only ever after an answer, which is why the payload needs no reason field.
   * A wallet-initiated disconnect must not send this: the dApp learns about it
   * over the relay, and the app acts on DAPP_RETURN by backgrounding itself on
   * Android (app PR #61), which would drop the user out of the wallet they are
   * still using. If a non-approval message is ever needed, it has to name
   * itself in the payload so the app can tell them apart.
   */
  private maybeReturnToDApp(channelId: string): void {
    const safeRedirectUrl = this.resolveReturnTarget(channelId);
    if (safeRedirectUrl === null) {
      const conn = this.connections.get(channelId);
      if (isInNativeApp() && conn?.originatedViaDeepLink && conn.dappInfo.redirectUrl) {
        dlog("Ignoring unsafe dApp redirect URL");
      }
      return;
    }
    sendToNative("DAPP_RETURN", { channelId, redirectUrl: safeRedirectUrl });
    // Android brings the browser tab back by itself. On iOS nothing does, so
    // the page is told that this is the moment to say so, and it is only ever
    // this moment: the answer is out and the dApp has it.
    this.handlers?.onReturnHandedBack?.(channelId);
  }

  /**
   * Tell the native app a pairing is gone so its dApp connections screen
   * stops listing it. Every path that removes a stored session has to call
   * this; the native list has no other way to learn about it.
   */
  private notifyNativeDisconnected(channelId: string, explicit: boolean): void {
    if (isInNativeApp()) {
      sendToNative("DAPP_DISCONNECTED" as never, { channelId, explicit });
    }
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
      // An offline pairing removed from the banner: without this the app's
      // dApp list kept showing it as connected.
      this.notifyNativeDisconnected(channelId, true);
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

  /**
   * The relay would not take this channel back within the retry budget.
   *
   * The live connection goes, because nothing can be delivered through it, and
   * the wallet shows that it will try again later. The stored session stays:
   * the relay's connect window is a minute and its socket cap can last far
   * longer behind carrier NAT, so a transient refusal must not unpair the user
   * and leave the dApp paired to nothing. The next foreground, reload or user
   * action retries it through reconnectAll.
   *
   * The one case that does retire the pairing is a parked sealed frame. Its
   * counter is spent and checkpointed, so storage is ahead of what the dApp
   * received. Keeping that session would leave a gap in the stream, which the
   * peer answers by tearing the pairing down once two more messages arrive.
   */
  private handleReconnectAbandoned(channelId: string): void {
    const conn = this.connections.get(channelId);
    const storageAhead = conn?.pendingRetransmit != null;

    if (storageAhead) {
      console.warn(
        `[DAppConnect] relay will not take ${channelId} back and a sealed frame is undelivered; retiring the pairing`,
      );
      void this.teardownSession(channelId, false, false, false, false).catch(
        (err) => console.error("[DAppConnect] retire after abandon failed:", err),
      );
      return;
    }

    console.warn(
      `[DAppConnect] relay will not take ${channelId} back for now; keeping the session for a later retry`,
    );
    if (conn) {
      // Anything held was queued for this connection and cannot outlive it.
      conn.offlineOutbox = [];
      conn.flushing = false;
      try {
        SessionStore.updateStatus(
          channelId,
          SessionStatus.DISCONNECTED,
          conn.walletEpoch,
        );
      } catch (err) {
        console.error(
          "[DAppConnect] could not record the deferred reconnect:",
          err,
        );
      }
      conn.socketClient.disconnect();
      this.connections.delete(channelId);
    }
    this.clearDappLeaveTimeout(channelId);
    this.pendingRestrictedMethods.delete(channelId);
    // Close anything still on screen for this channel. The pairing survives,
    // the approval does not: approving a send now would broadcast a real
    // transaction with no way to answer the dApp, and a user who sees no
    // result sends again and pays twice.
    this.handlers?.onSessionDisconnected(channelId);
    this.handlers?.onSessionsChanged();
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
    // The outbox lives on the connection, so it goes when the connection does.

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
        // The relay refuses close_channel for a channel that is already
        // closed. A user disconnect sends TERMINATE first and the dApp often
        // answers with its own close before ours arrives, or the channel was
        // closed while this socket was away. Treating that refusal as a
        // failure kept the session and never told the native app, so ask the
        // relay directly: a fresh join reports an existing tombstone, and
        // otherwise closes the channel itself.
        if (teardown.requireTombstone && !tombstoneConfirmed) {
          const stored = SessionStore.get(channelId);
          if (stored) tombstoneConfirmed = await this.tombstoneStoredSession(stored);
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

      this.notifyNativeDisconnected(channelId, teardown.explicit);
      return teardown.success;
    };

    try {
      // Only attempt the encrypted TERMINATE when there's a live, keyed
      // session and crypto state is still durable. TERMINATE uses the same
      // outbound encrypt/checkpoint/send queue as every other ciphertext.
      // Skipped when the relay is away. A TERMINATE is only meaningful on a
      // live socket: queueing one would hold a goodbye for a connection that
      // is being destroyed, and a restored session for the same channel would
      // then deliver it through a later connection lifetime.
      if (
        conn &&
        teardown.sendTerminate &&
        conn.cryptoUsable &&
        conn.keyExchange.areKeysExchanged() &&
        conn.socketClient.isJoined()
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
            onReconnectAbandoned: () => {
              this.handleReconnectAbandoned(session.id);
            },
            onRejoinAbandoned: () => {
              this.handleReconnectAbandoned(session.id);
            },
            onReconnected: () => {
              if (keyExchange.areKeysExchanged()) {
                this.updateLiveSessionStatus(
                  session.id,
                  socketClient,
                  SessionStatus.CONNECTED,
                );
                this.flushOfflineOutbox(session.id);
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
            offlineOutbox: [],
            flushing: false,
            pendingRetransmit: null,
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
            this.notifyNativeDisconnected(session.id, false);
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
    // Pairings without a live connection are only removed by clearStale
    // below; the native dApp list hears about them from here.
    const offlineIds = SessionStore.getAll()
      .map((session) => session.id)
      .filter((id) => !this.connections.has(id));
    const clearEpoch = advanceEpoch ? advanceWalletEpoch() : this.walletEpoch;
    try {
      await this.disconnectAll();
      await this.epochTeardown;
    } finally {
      SessionStore.clearStale(clearEpoch);
      this.handlers?.onSessionsChanged();
      for (const id of offlineIds) this.notifyNativeDisconnected(id, true);
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
   * Hold a message until the relay is reachable again.
   *
   * Only ever plaintext. Sealing a message consumes a send counter and
   * checkpoints it to storage before the ciphertext leaves, so a sealed
   * message parked here would leave storage ahead of what the dApp received:
   * a gap in the AEAD stream, which the peer answers by tearing the pairing
   * down after two more messages. Queueing before any counter is touched keeps
   * the stream contiguous, because a counter is only consumed when there is a
   * socket to hand the result to.
   *
   * Bounded by count and by age. Five minutes is when the SDK rejects a
   * pending request, so a later delivery answers a promise nobody holds; it is
   * an upper bound, since the SDK's timer starts when the dApp sent the
   * request, which is earlier than this one.
   */
  private queueUntilReconnected(
    conn: ActiveConnection,
    entry: OfflineOutboxEntry,
  ): boolean {
    const now = Date.now();
    conn.offlineOutbox = conn.offlineOutbox.filter(
      (held) => now - held.queuedAt < OFFLINE_OUTBOX_TTL_MS,
    );

    if (conn.offlineOutbox.length >= OFFLINE_OUTBOX_LIMIT) {
      // Never evict an answer to make room. Dropping the oldest entry used to
      // discard exactly the message that matters, the transaction hash, in
      // favour of whatever read responses arrived after it. Refuse the new
      // non-answer instead, and say so.
      if (!entry.isAnswer) {
        console.warn(
          `[DAppConnect] outbox full for ${conn.channelId}; refusing to hold another message`,
        );
        return false;
      }
      const evictable = conn.offlineOutbox.findIndex((held) => !held.isAnswer);
      if (evictable === -1) {
        console.warn(
          `[DAppConnect] outbox full of answers for ${conn.channelId}; refusing to hold another`,
        );
        return false;
      }
      conn.offlineOutbox.splice(evictable, 1);
      console.warn(
        `[DAppConnect] outbox full for ${conn.channelId}; dropped a non-answer to hold an answer`,
      );
    }

    conn.offlineOutbox.push(entry);
    dlog(
      `Relay unreachable; holding a message for ${conn.channelId} (${conn.offlineOutbox.length} held)`,
    );
    return true;
  }

  /**
   * Send what was held while the relay was away, oldest first.
   *
   * Entries are taken one at a time and only removed once they are actually
   * sent. A second drop mid-flush therefore leaves the rest in place, in
   * order, with the ages they were first queued with. Deleting the whole queue
   * up front lost everything after the first undelivered entry.
   */
  private flushOfflineOutbox(channelId: string): void {
    const conn = this.connections.get(channelId);
    if (!conn) return;
    // A parked frame is work too, even with an empty queue.
    if (conn.offlineOutbox.length === 0 && conn.pendingRetransmit === null) return;
    // Two reconnect events in quick succession would otherwise start two
    // loops, both peeking the same head entry before either shifted it, and
    // deliver every held message twice.
    if (conn.flushing) return;
    conn.flushing = true;

    const now = Date.now();
    const before = conn.offlineOutbox.length;
    conn.offlineOutbox = conn.offlineOutbox.filter(
      (entry) => now - entry.queuedAt < OFFLINE_OUTBOX_TTL_MS,
    );
    const expired = before - conn.offlineOutbox.length;
    if (expired > 0) {
      console.warn(
        `[DAppConnect] dropped ${expired} held message(s) for ${channelId}: the dApp stopped waiting`,
      );
    }
    // A parked frame is still work when everything queued has expired, and
    // the flushing flag has to be released on the way out either way.
    if (conn.offlineOutbox.length === 0 && conn.pendingRetransmit === null) {
      conn.flushing = false;
      return;
    }

    dlog(
      `Delivering ${conn.offlineOutbox.length} held message(s)` +
        `${conn.pendingRetransmit ? " and a parked frame" : ""} for ${channelId}`,
    );
    void (async () => {
      try {
        // A parked frame is already sealed at a spent counter, so it goes out
        // first and on its own. Without this it would only ever ride along
        // with the next message, and an empty queue would strand it.
        if (conn.pendingRetransmit !== null) {
          const sent = await this.drainRetransmit(channelId, conn);
          if (!sent) return;
        }
        while (conn.offlineOutbox.length > 0) {
          if (this.connections.get(channelId) !== conn) return;
          const next = conn.offlineOutbox[0];
          if (next === undefined) return;
          const { outcome, parked } = await this.sendEncryptedTracked(
            channelId,
            next.message,
            {
              isAnswer: next.isAnswer,
              queuedAt: next.queuedAt,
              alreadyQueued: true,
            },
          );
          if (outcome === "sent") {
            if (conn.offlineOutbox[0] === next) conn.offlineOutbox.shift();
            continue;
          }
          // This entry itself became the parked frame: it is sealed and its
          // counter is spent, so the plaintext must not be sealed again.
          if (parked && conn.offlineOutbox[0] === next) {
            conn.offlineOutbox.shift();
          }
          // Still unreachable or gone. Everything left stays queued in order
          // with its original age.
          return;
        }
      } finally {
        conn.flushing = false;
      }
    })();
  }

  /**
   * Put the parked frame on the wire, unchanged, ahead of anything else.
   *
   * Goes through the outbound queue so it cannot overtake or be overtaken by
   * a send already in flight. Returns whether it left.
   */
  private drainRetransmit(
    channelId: string,
    conn: ActiveConnection,
  ): Promise<boolean> {
    const task = conn.outboundQueue.then(async () => {
      const parked = conn.pendingRetransmit;
      if (parked === null) return;
      if (this.connections.get(channelId) !== conn || !conn.cryptoUsable) {
        throw new Error("retransmit: connection is no longer active");
      }
      await this.emitFrame(channelId, conn, parked.encrypted);
      if (conn.pendingRetransmit === parked) conn.pendingRetransmit = null;
    });
    conn.outboundQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task.then(
      () => true,
      (err: unknown) => {
        if (!(err instanceof SocketNotConnectedError)) {
          console.error("[DAppConnect] retransmit failed:", err);
        }
        return false;
      },
    );
  }

  /**
   * Encrypt and send a message to the dApp.
   *
   * `sent` means the relay acknowledged it. `held` means the relay is
   * unreachable and the message is queued for delivery when it returns, which
   * callers must treat as progress. `failed` means it will never be delivered.
   *
   * Reachability is checked before the crypto, and again inside the serialized
   * task just before sealing. Without the second check a socket that dropped
   * while the task waited its turn would reach SocketClient.sendMessage, be
   * reported as an ambiguous relay outcome and tombstone the pairing, having
   * spent a counter on a frame nobody saw.
   */
  private sendEncrypted(
    channelId: string,
    message: object,
    options: { isAnswer?: boolean; queuedAt?: number; alreadyQueued?: boolean } = {},
  ): Promise<SendOutcome> {
    return this.sendEncryptedTracked(channelId, message, options).then(
      (result) => result.outcome,
    );
  }

  /**
   * As sendEncrypted, and it also says whether THIS call's own message ended
   * up as the parked frame.
   *
   * The flush needs that answer about its own entry. Inferring it from
   * `pendingRetransmit` changing identity was wrong: a direct send parking a
   * frame at the same moment produced a new object too, and the flush then
   * shifted an entry that had never been sealed, losing a held answer.
   */
  private sendEncryptedTracked(
    channelId: string,
    message: object,
    options: { isAnswer?: boolean; queuedAt?: number; alreadyQueued?: boolean } = {},
  ): Promise<{ outcome: SendOutcome; parked: boolean }> {
    const conn = this.connections.get(channelId);
    if (!conn?.cryptoUsable) {
      return Promise.resolve({ outcome: "failed" as SendOutcome, parked: false });
    }

    const isAnswer = options.isAnswer ?? false;
    const queuedAt = options.queuedAt ?? Date.now();
    const hold = (): SendOutcome => {
      // A socket that will never come back must not absorb messages silently.
      // The relay force-disconnects on its rate limits and caps, and socket.io
      // does not retry a server-initiated disconnect, so without this a
      // session would sit in RECONNECTING swallowing answers until a reload.
      if (!conn.socketClient.willReconnect()) return "failed";
      if (!options.alreadyQueued) {
        const queued = this.queueUntilReconnected(conn, {
          message,
          queuedAt,
          isAnswer,
        });
        // A refused message will never be delivered, so saying "held" would
        // tell the caller it is on its way when nothing is.
        if (!queued) return "failed";
      }
      return "held";
    };

    if (!conn.socketClient.isJoined()) {
      return Promise.resolve({ outcome: hold(), parked: false });
    }

    const task = conn.outboundQueue.then(() =>
      this.sendEncryptedNow(channelId, message, conn),
    );
    // Keep the per-channel queue alive after a failed task while still
    // propagating that failure to this caller below.
    conn.outboundQueue = task.then(
      () => undefined,
      () => undefined,
    );

    return task.then(
      () => ({ outcome: "sent" as SendOutcome, parked: false }),
      (err: unknown) => {
        if (err instanceof FrameParkedError) {
          // This message is already sealed and its counter is spent. The frame
          // goes out first on reconnect, so queueing the plaintext as well
          // would deliver the same answer twice.
          return { outcome: "held" as SendOutcome, parked: true };
        }
        if (err instanceof SocketNotConnectedError) {
          // Raised before any emit, so nothing left this process and no
          // counter was spent. Unambiguous, and safe to hold.
          return { outcome: hold(), parked: false };
        }
        console.error("[DAppConnect] Failed to send encrypted:", err);
        return { outcome: "failed" as SendOutcome, parked: false };
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

    // A sealed frame whose socket died between its checkpoint and its send
    // goes out first and unchanged. Its counter is already spent and
    // persisted, so anything else sealed ahead of it would leave a gap.
    // Re-sending identical bytes under the same counter reuses no nonce.
    if (conn.pendingRetransmit !== null) {
      const retransmit = conn.pendingRetransmit;
      await this.emitFrame(channelId, conn, retransmit.encrypted);
      if (conn.pendingRetransmit === retransmit) conn.pendingRetransmit = null;
    }

    // Checked again here, inside the serialized task. The check at enqueue
    // time can be minutes old: the task waits its turn behind other sends,
    // and a backgrounded WebView can resume with the socket already closed.
    // Sealing against a dead socket spends a counter on a frame nobody sees.
    // Membership, not socket-level connectedness: a reconnected socket is
    // `connected` a full relay round trip before its rejoin is acknowledged,
    // and the relay refuses a frame from a non-member.
    if (!conn.socketClient.isJoined()) {
      throw new SocketNotConnectedError();
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
      await this.emitFrame(channelId, conn, encrypted);
    } catch (err) {
      // Parked: sealed, counter spent, waiting to go out unchanged. Reported
      // as its own class so the caller does not also queue the plaintext.
      if (err instanceof SocketNotConnectedError) throw new FrameParkedError();
      throw err;
    }
  }

  /**
   * Put one sealed frame on the wire.
   *
   * Two failures are unambiguous, and both keep the frame for retransmission
   * and tell the caller to hold: a socket known to be down before anything was
   * emitted, and a relay refusal that names a pre-delivery reason. The relay
   * decides both of its membership refusals before it routes, buffers or
   * records a sequence number, so the same sealed bytes go out again at the
   * same counter and the peer's stream stays contiguous.
   *
   * Every other failure is a rejected or missing acknowledgement, which the
   * relay may still have accepted, so it stays fail-closed.
   */
  private async emitFrame(
    channelId: string,
    conn: ActiveConnection,
    encrypted: string,
  ): Promise<void> {
    try {
      await conn.socketClient.sendMessage({
        id: channelId,
        clientType: "wallet",
        message: encrypted,
      });
    } catch (err) {
      // RelayChannelNotJoinedError is a subclass, so a membership refusal
      // lands here too.
      if (err instanceof SocketNotConnectedError) {
        conn.pendingRetransmit = { encrypted };
        throw err;
      }
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

  /**
   * Answer one dApp request. Marked as an answer, so the outbox never evicts
   * it to make room for something the dApp is not waiting on.
   */
  private sendJsonRpcResponse(
    channelId: string,
    response: JsonRpcResponse,
  ): Promise<SendOutcome> {
    return this.sendEncrypted(
      channelId,
      { type: MessageType.JSONRPC, ...response },
      { isAnswer: true },
    );
  }
}

// Singleton
export const dappConnectService = new DAppConnectService();
