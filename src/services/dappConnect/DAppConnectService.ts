/**
 * DApp Connect Service — wallet-side orchestrator for incoming dApp connections.
 *
 * Handles v2 URI parsing, relay communication, the post-quantum handshake,
 * request routing, and session management. All approval UI renders in the
 * WebView (single source of truth).
 */

import {
  KeyExchange,
  type AckMessage,
  type SynAckMessage,
} from './KeyExchange';
import { parseConnectionURI, cidToString, computeFingerprint, fingerprintEquals } from './qrUri';
import { fromBase64 } from './PQCrypto';
import { SocketClient } from './SocketClient';
import { RequestHandler } from './RequestHandler';
import { SessionStore } from './SessionStore';
import {
  type DAppInfo,
  type DAppSession,
  type PendingDAppRequest,
  type RelayMessage,
  type JsonRpcResponse,
  KeyExchangeMessageType,
  MessageType,
  SessionStatus,
} from './types';
import { isInNativeApp, sendToNative, triggerHaptic, logToNative } from '@/utils/nativeApp';
import { store } from '@/stores/store';

function dlog(msg: string): void {
  console.log(`[DAppConnect] ${msg}`);
  logToNative(`[DAppConnect] ${msg}`);
}

const DEFAULT_RELAY_URL = 'https://qrlwallet.com';
const DAPP_REJOIN_GRACE_MS = 30000;
const TERMINATE_SEND_TIMEOUT_MS = 800;

interface ActiveConnection {
  socketClient: SocketClient;
  keyExchange: KeyExchange;
  dappInfo: DAppInfo;
  channelId: string;
  originatorInfoReceived: boolean;
  messageQueue: Promise<void>;
  // Relay URL the live SocketClient is actually talking to. Tracked
  // separately from the persisted session so persistSession() can store
  // the real URL rather than falling back to DEFAULT_RELAY_URL on first
  // save, which would silently point reconnects at prod when running on
  // dev/staging.
  relayUrl: string;
}

type ServiceEventHandler = {
  onSessionsChanged: () => void;
  onPendingRequest: (request: PendingDAppRequest) => void;
  onSessionConnected: (sessionId: string) => void;
  onSessionDisconnected: (sessionId: string) => void;
};

interface RpcRequestProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

function getRequestProvider(web3: unknown): RpcRequestProvider | null {
  if (typeof web3 !== 'object' || web3 === null) return null;
  const provider = (web3 as { currentProvider?: unknown }).currentProvider;
  if (typeof provider !== 'object' || provider === null) return null;
  if (typeof (provider as { request?: unknown }).request !== 'function') return null;
  return provider as RpcRequestProvider;
}

export class DAppConnectService {
  private connections = new Map<string, ActiveConnection>();
  private dappLeaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private handlers: ServiceEventHandler | null = null;

  setHandlers(handlers: ServiceEventHandler): void {
    this.handlers = handlers;
  }

  /**
   * Handle an incoming qrlconnect:// URI (from QR scan or deep link).
   * For v2: the URI carries the dApp's ML-KEM public key; the wallet runs
   * Encaps → emits SYNACK → awaits ACK.
   */
  async handleConnectionURI(uri: string): Promise<{ success: boolean; error?: string }> {
    let parsed;
    try {
      parsed = await parseConnectionURI(uri);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dlog(`URI parse failed: ${msg}`);
      return { success: false, error: msg };
    }

    const channelId = cidToString(parsed.cid);

    if (this.connections.has(channelId)) {
      return { success: true };
    }

    // Real dApp info arrives in the first encrypted ORIGINATOR_INFO message;
    // show a placeholder until then. DAPP_CONNECTED is deferred until we
    // actually know who the dApp is.
    const placeholder: DAppInfo = {
      name: 'Connecting…',
      url: '',
      icon: undefined,
      chainId: '0x0',
    };

    // v2 preserves v1's flexibility to target a non-default relay: the dApp
    // may carry an `r=<url>` query param alongside the PQP1 blob. The relay
    // URL is OUTSIDE the fingerprint-covered blob — a tampered relay can
    // only cause DoS, not break confidentiality (AEAD + transcript-bound
    // session key stand independent of the relay we connect to).
    const relayUrl = parsed.relayUrl || DEFAULT_RELAY_URL;
    const keyExchange = new KeyExchange(undefined, {
      onKeysExchanged: () => this.onKeysExchanged(channelId),
    });

    const socketClient = new SocketClient(relayUrl, {
      onMessage: (data) => {
        if (data.clientType === 'dapp') {
          this.clearDappLeaveTimeout(channelId);
        }
        this.enqueueRelayMessage(channelId, data);
      },
      onConnected: () => {
        dlog(`Socket connected to relay for channel ${channelId}`);
      },
      onDisconnected: (reason) => {
        dlog(`Socket disconnected: ${reason}`);
        SessionStore.updateStatus(channelId, SessionStatus.RECONNECTING);
        this.handlers?.onSessionsChanged();
      },
      onReconnected: () => {
        dlog(`Socket reconnected for channel ${channelId}`);
        const conn = this.connections.get(channelId);
        if (conn?.keyExchange.areKeysExchanged()) {
          SessionStore.updateStatus(channelId, SessionStatus.CONNECTED);
          this.handlers?.onSessionsChanged();
        }
      },
      onParticipantsChanged: (data) => {
        this.handleParticipantsChanged(channelId, data);
      },
    });

    const connection: ActiveConnection = {
      socketClient,
      keyExchange,
      dappInfo: placeholder,
      channelId,
      originatorInfoReceived: false,
      messageQueue: Promise.resolve(),
      relayUrl,
    };
    this.connections.set(channelId, connection);
    this.handlers?.onSessionsChanged();

    // v2 PQP2 protocol: the QR carries only cid + fp. We must join the
    // relay first to fetch the dApp's PK, verify it against fp, and only
    // then run Encaps. This is the "PK lives on the relay, fp pins it
    // cryptographically" design — see docs/qr-uri-v2.md.
    let channelPublicKey: string | null;
    try {
      dlog(`Connecting to relay ${relayUrl} as wallet participant`);
      socketClient.connect();
      const joinResult = await socketClient.joinChannel(channelId);
      channelPublicKey = joinResult.channelPublicKey;
      dlog(
        `joinChannel returned ${joinResult.bufferedMessages.length} buffered msg(s), pk present: ${channelPublicKey !== null}`
      );

      if (!channelPublicKey) {
        // dApp hasn't registered a PK yet (race), or relay forgot. For a
        // fresh scan the wallet has no existing session to fall back on,
        // so bail with a clear error — the user can rescan when the dApp
        // is actually live.
        throw new Error(
          'dApp has not registered its public key with the relay yet — retry the scan'
        );
      }

      const pk = fromBase64(channelPublicKey);
      const expectedFp = await computeFingerprint(parsed.cid, pk);
      if (!fingerprintEquals(parsed.fp, expectedFp)) {
        // The relay served a PK whose fingerprint doesn't match the QR.
        // Either a malicious relay is trying to MITM, or the QR is stale
        // and pointing at a channel rebound by a different dApp. Refuse.
        throw new Error(
          'Relay-provided public key does not match the fingerprint from the QR'
        );
      }

      let synack: SynAckMessage;
      try {
        synack = await keyExchange.receiveQR(parsed.cid, pk);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        dlog(`KEM encaps failed: ${msg}`);
        this.connections.delete(channelId);
        this.handlers?.onSessionsChanged();
        return { success: false, error: msg };
      }

      // Send SYNACK — this kicks off the visible portion of the handshake.
      await socketClient.sendMessage({
        id: channelId,
        clientType: 'wallet',
        message: synack,
      });

      for (const msg of joinResult.bufferedMessages) {
        this.enqueueRelayMessage(channelId, msg as RelayMessage);
      }

      return { success: true };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      dlog(`Connection failed: ${errMsg}`);
      this.connections.delete(channelId);
      SessionStore.remove(channelId);
      this.handlers?.onSessionsChanged();
      return { success: false, error: errMsg };
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

    SessionStore.updateStatus(channelId, SessionStatus.CONNECTED);
    await this.persistSession(channelId);

    const activeAccount = store.qrlStore.activeAccount?.accountAddress || '';
    await this.sendEncrypted(channelId, {
      type: MessageType.WALLET_INFO,
      accounts: activeAccount ? [activeAccount] : [],
      chainId: conn.dappInfo.chainId,
    });

    this.handlers?.onSessionConnected(channelId);
    this.handlers?.onSessionsChanged();
  }

  private async persistSession(channelId: string): Promise<void> {
    const conn = this.connections.get(channelId);
    if (!conn) return;
    const persistedKex = await conn.keyExchange.exportPersisted();
    if (!persistedKex) return;
    const existing = SessionStore.get(channelId);
    const activeAccount = store.qrlStore.activeAccount?.accountAddress || '';
    const session: DAppSession = {
      version: 2,
      id: channelId,
      dappInfo: conn.dappInfo,
      connectedAccount: activeAccount || existing?.connectedAccount || '',
      keyExchange: persistedKex,
      relayUrl: conn.relayUrl,
      status: conn.keyExchange.areKeysExchanged()
        ? SessionStatus.CONNECTED
        : SessionStatus.KEY_EXCHANGE,
      createdAt: existing?.createdAt || Date.now(),
      lastActivity: Date.now(),
    };
    SessionStore.save(session);
  }

  private enqueueRelayMessage(channelId: string, data: RelayMessage): void {
    const conn = this.connections.get(channelId);
    if (!conn) return;
    // .catch keeps the queue alive: a single rejected handler (tag-fail,
    // bad JSON) must not starve every subsequent message on this channel.
    conn.messageQueue = conn.messageQueue
      .then(() => this.handleRelayMessage(channelId, data))
      .catch((err) =>
        dlog(
          `messageQueue error on ${channelId}: ${err instanceof Error ? err.message : String(err)}`
        )
      );
  }

  private async handleRelayMessage(channelId: string, data: RelayMessage): Promise<void> {
    const conn = this.connections.get(channelId);
    if (!conn) {
      dlog(`handleRelayMessage: no connection for ${channelId}`);
      return;
    }

    const message = data.message;

    if (typeof message === 'object' && message !== null) {
      const msg = message as { type?: string };
      if (msg.type === KeyExchangeMessageType.ACK) {
        try {
          await conn.keyExchange.onAck(message as AckMessage);
        } catch (err) {
          dlog(`ACK verify failed: ${err instanceof Error ? err.message : err}`);
          this.disconnectSession(channelId, false);
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

    if (typeof message === 'string' && conn.keyExchange.areKeysExchanged()) {
      try {
        const decrypted = await conn.keyExchange.decryptMessage(message);
        const parsed = JSON.parse(decrypted);
        await this.handleDecryptedMessage(channelId, parsed);
      } catch (err) {
        console.error('[DAppConnect] Failed to decrypt message:', err);
      }
    }
  }

  private async handleDecryptedMessage(
    channelId: string,
    msg: Record<string, unknown>
  ): Promise<void> {
    const conn = this.connections.get(channelId);
    if (!conn) return;

    const type = msg.type as string;

    switch (type) {
      case MessageType.ORIGINATOR_INFO: {
        const info = msg.originatorInfo as DAppInfo | undefined;
        if (info) {
          conn.dappInfo = {
            name: info.name || conn.dappInfo.name,
            url: info.url || conn.dappInfo.url,
            icon: info.icon || conn.dappInfo.icon,
            chainId: info.chainId || conn.dappInfo.chainId,
          };
          const firstTime = !conn.originatorInfoReceived;
          conn.originatorInfoReceived = true;
          await this.persistSession(channelId);
          this.handlers?.onSessionsChanged();
          if (firstTime && isInNativeApp()) {
            const activeAccount =
              store.qrlStore.activeAccount?.accountAddress || '';
            sendToNative('DAPP_CONNECTED' as never, {
              name: conn.dappInfo.name,
              url: conn.dappInfo.url,
              channelId,
              connectedAccount: activeAccount,
            });
            triggerHaptic('success');
          }
        }
        break;
      }

      case MessageType.JSONRPC: {
        const method = msg.method as string;
        const id = msg.id as string | number;
        const params = msg.params as unknown[] | undefined;

        if (!method) return;

        if (!RequestHandler.isKnownMethod(method)) {
          await this.sendJsonRpcResponse(channelId, {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          });
          return;
        }

        if (RequestHandler.isRestricted(method)) {
          const pendingRequest = RequestHandler.createPendingRequest(
            channelId,
            { method, params, id },
            conn.dappInfo
          );
          this.handlers?.onPendingRequest(pendingRequest);

          if (isInNativeApp()) {
            sendToNative('DAPP_SHOW_WEBVIEW' as never, {
              name: conn.dappInfo.name,
              method,
            });
            triggerHaptic('warning');
          }
        } else {
          await this.proxyRpcRequest(channelId, id, method, params);
        }
        break;
      }

      case MessageType.TERMINATE: {
        this.disconnectSession(channelId);
        break;
      }

      default:
        console.log('[DAppConnect] Unhandled message type:', type);
    }
  }

  private async proxyRpcRequest(
    channelId: string,
    id: string | number,
    method: string,
    params?: unknown[]
  ): Promise<void> {
    try {
      const web3 = store.qrlStore.qrlInstance;
      if (!web3) throw new Error('Web3 not initialized');
      const provider = getRequestProvider(web3);
      if (!provider) throw new Error('Web3 provider does not support request()');

      const result = await provider.request({ method, params });
      await this.sendJsonRpcResponse(channelId, {
        jsonrpc: '2.0',
        id,
        result,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.sendJsonRpcResponse(channelId, {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: errMsg },
      });
    }
  }

  approveRequest(sessionId: string, requestId: string | number, result: unknown): void {
    void this.sendJsonRpcResponse(sessionId, {
      jsonrpc: '2.0',
      id: requestId,
      result,
    });
    if (isInNativeApp()) triggerHaptic('success');
  }

  rejectRequest(
    sessionId: string,
    requestId: string | number,
    message = 'User rejected the request'
  ): void {
    void this.sendJsonRpcResponse(sessionId, {
      jsonrpc: '2.0',
      id: requestId,
      error: { code: 4001, message },
    });
    if (isInNativeApp()) triggerHaptic('error');
  }

  disconnectSession(channelId: string, explicit = true): void {
    dlog(`disconnectSession called for ${channelId}`);
    this.clearDappLeaveTimeout(channelId);
    const conn = this.connections.get(channelId);
    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;

      const activeConn = this.connections.get(channelId);
      if (activeConn) {
        activeConn.socketClient.leaveChannel();
        activeConn.socketClient.disconnect();
        this.connections.delete(channelId);
      }

      SessionStore.remove(channelId);
      this.handlers?.onSessionDisconnected(channelId);
      this.handlers?.onSessionsChanged();

      if (isInNativeApp()) {
        sendToNative('DAPP_DISCONNECTED' as never, { channelId, explicit });
      }
    };

    if (!conn || !conn.keyExchange.areKeysExchanged()) {
      finalize();
      return;
    }

    const sendTerminate = async () => {
      try {
        const encrypted = await conn.keyExchange.encryptMessage(
          JSON.stringify({ type: MessageType.TERMINATE })
        );
        await conn.socketClient.sendMessage({
          id: channelId,
          clientType: 'wallet',
          message: encrypted,
        });
      } catch (err) {
        console.error('[DAppConnect] Failed to send terminate:', err);
      }
    };

    void Promise.race([
      sendTerminate(),
      new Promise((resolve) => setTimeout(resolve, TERMINATE_SEND_TIMEOUT_MS)),
    ]).finally(() => {
      finalize();
    });
  }

  getActiveSessions(): DAppSession[] {
    return SessionStore.getAll();
  }

  /**
   * Reconnect all stored sessions (called on app launch / foreground).
   */
  async reconnectAll(): Promise<void> {
    dlog(`reconnectAll called`);
    for (const channelId of this.dappLeaveTimers.keys()) {
      this.clearDappLeaveTimeout(channelId);
    }
    const sessions = SessionStore.getAll();
    for (const session of sessions) {
      if (this.connections.has(session.id)) continue;

      try {
        const restored = await KeyExchange.sessionFromPersisted(session.keyExchange);
        const keyExchange = new KeyExchange(restored, {
          onKeysExchanged: () => this.onKeysExchanged(session.id),
        });

        const reconnectRelayUrl = session.relayUrl || DEFAULT_RELAY_URL;
        const socketClient = new SocketClient(
          reconnectRelayUrl,
          {
            onMessage: (data) => {
              if (data.clientType === 'dapp') {
                this.clearDappLeaveTimeout(session.id);
              }
              this.enqueueRelayMessage(session.id, data);
            },
            onConnected: () =>
              dlog(`Reconnected to relay for ${session.dappInfo.name}`),
            onDisconnected: () => {
              SessionStore.updateStatus(session.id, SessionStatus.RECONNECTING);
              this.handlers?.onSessionsChanged();
            },
            onReconnected: () => {
              if (keyExchange.areKeysExchanged()) {
                SessionStore.updateStatus(session.id, SessionStatus.CONNECTED);
                this.handlers?.onSessionsChanged();
              }
            },
            onParticipantsChanged: (data) => {
              this.handleParticipantsChanged(session.id, data);
            },
          }
        );

        this.connections.set(session.id, {
          socketClient,
          keyExchange,
          dappInfo: session.dappInfo,
          channelId: session.id,
          originatorInfoReceived: true,
          messageQueue: Promise.resolve(),
          relayUrl: reconnectRelayUrl,
        });

        socketClient.connect();
        const { bufferedMessages } = await socketClient.joinChannel(session.id);

        for (const msg of bufferedMessages) {
          this.enqueueRelayMessage(session.id, msg as RelayMessage);
        }

        if (keyExchange.areKeysExchanged()) {
          SessionStore.updateStatus(session.id, SessionStatus.CONNECTED);
        }
      } catch (err) {
        console.error('[DAppConnect] Failed to reconnect session:', session.id, err);
        SessionStore.updateStatus(session.id, SessionStatus.DISCONNECTED);
      }
    }

    this.handlers?.onSessionsChanged();
  }

  disconnectAll(): void {
    dlog(`disconnectAll called with ${this.connections.size} connections`);
    for (const channelId of this.connections.keys()) {
      this.disconnectSession(channelId);
    }
  }

  static isConnectionURI(uri: string): boolean {
    return /^qrlconnect:/i.test(uri);
  }

  // ── Private helpers ──

  private handleParticipantsChanged(
    channelId: string,
    data: { event: string; clientType?: string }
  ): void {
    dlog(`Participants changed: ${data.event} (${data.clientType || 'unknown'})`);

    if (data.event === 'join' && data.clientType === 'dapp') {
      this.clearDappLeaveTimeout(channelId);
      return;
    }

    if (
      (data.event === 'disconnect' || data.event === 'leave') &&
      (data.clientType === 'dapp' || !data.clientType)
    ) {
      this.scheduleDappLeaveTimeout(channelId);
    }
  }

  private scheduleDappLeaveTimeout(channelId: string): void {
    this.clearDappLeaveTimeout(channelId);
    const timeout = setTimeout(() => {
      this.dappLeaveTimers.delete(channelId);
      if (!this.connections.has(channelId)) return;
      dlog(`dApp absent for ${DAPP_REJOIN_GRACE_MS}ms; disconnecting`);
      this.disconnectSession(channelId, false);
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

  private async sendEncrypted(channelId: string, message: object): Promise<void> {
    const conn = this.connections.get(channelId);
    if (!conn) return;
    try {
      const encrypted = await conn.keyExchange.encryptMessage(
        JSON.stringify(message)
      );
      await conn.socketClient.sendMessage({
        id: channelId,
        clientType: 'wallet',
        message: encrypted,
      });
    } catch (err) {
      console.error('[DAppConnect] Failed to send encrypted:', err);
    }
  }

  private sendJsonRpcResponse(
    channelId: string,
    response: JsonRpcResponse
  ): Promise<void> {
    return this.sendEncrypted(channelId, {
      type: MessageType.JSONRPC,
      ...response,
    });
  }
}

// Singleton
export const dappConnectService = new DAppConnectService();
