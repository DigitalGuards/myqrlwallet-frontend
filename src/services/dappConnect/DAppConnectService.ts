/**
 * DApp Connect Service - Singleton orchestrator for incoming dApp connections.
 * Handles connection URI parsing, relay communication, key exchange,
 * request routing, and session management.
 *
 * All approval UI is rendered in the WebView (single source of truth).
 */

import { ECIESManager } from './ECIESManager';
import { KeyExchange } from './KeyExchange';
import { SocketClient } from './SocketClient';
import { RequestHandler } from './RequestHandler';
import { SessionStore } from './SessionStore';
import {
  type ConnectParams,
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

/** Debug log that goes to both console and native app logs */
function dlog(msg: string): void {
  console.log(`[DAppConnect] ${msg}`);
  logToNative(`[DAppConnect] ${msg}`);
}

const DEFAULT_RELAY_URL = 'https://qrlwallet.com';
const DAPP_REJOIN_GRACE_MS = 30000;
const TERMINATE_SEND_TIMEOUT_MS = 800;

/** Parse a qrlconnect:// URI */
function parseConnectionURI(uri: string): ConnectParams | null {
  try {
    const queryString = uri.replace(/^qrlconnect:\/?\/?/, '');
    const params = new URLSearchParams(queryString);

    const channelId = params.get('channelId');
    const pubKey = params.get('pubKey');
    const name = params.get('name');
    const url = params.get('url');
    const chainId = params.get('chainId');
    const relay = params.get('relay');

    if (!channelId || !pubKey || !name || !url || !chainId || !relay) {
      return null;
    }

    return { channelId, pubKey, name, url, icon: params.get('icon') || undefined, chainId, relay };
  } catch {
    return null;
  }
}

/** Active connection state for a single session */
interface ActiveConnection {
  socketClient: SocketClient;
  ecies: ECIESManager;
  keyExchange: KeyExchange;
  dappInfo: DAppInfo;
  channelId: string;
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

  /**
   * Register event handlers. Called by the MobX store.
   */
  setHandlers(handlers: ServiceEventHandler): void {
    this.handlers = handlers;
  }

  /**
   * Handle an incoming qrlconnect:// URI (from QR scan or deep link).
   * Initiates connection to the relay and starts key exchange.
   */
  async handleConnectionURI(uri: string): Promise<{ success: boolean; error?: string }> {
    const params = parseConnectionURI(uri);
    if (!params) {
      return { success: false, error: 'Invalid connection URI' };
    }

    // Check if already connected to this channel
    if (this.connections.has(params.channelId)) {
      return { success: true }; // Already connected
    }

    const dappInfo: DAppInfo = {
      name: params.name,
      url: params.url,
      icon: params.icon,
      chainId: params.chainId,
    };

    const ecies = new ECIESManager();
    const keyExchange = new KeyExchange(
      ecies,
      params.pubKey,
      () => {
        this.onKeysExchanged(params.channelId);
      },
      { keysAlreadyExchanged: false }
    );

    const socketClient = new SocketClient(params.relay, {
      onMessage: (data) => {
        if (data.clientType === 'dapp') {
          this.clearDappLeaveTimeout(params.channelId);
        }
        dlog(`Relay message received: ${typeof data.message === 'object' ? JSON.stringify(data.message).slice(0, 100) : 'encrypted'}`);
        this.handleRelayMessage(params.channelId, data);
      },
      onConnected: () => {
        dlog(`Socket connected to relay for ${params.name}`);
      },
      onDisconnected: (reason) => {
        dlog(`Socket disconnected: ${reason}`);
        SessionStore.updateStatus(params.channelId, SessionStatus.RECONNECTING);
        this.handlers?.onSessionsChanged();
      },
      onReconnected: () => {
        dlog(`Socket reconnected for ${params.name}`);
        const conn = this.connections.get(params.channelId);
        if (conn?.keyExchange.areKeysExchanged()) {
          SessionStore.updateStatus(params.channelId, SessionStatus.CONNECTED);
          this.handlers?.onSessionsChanged();
        }
      },
      onParticipantsChanged: (data) => {
        this.handleParticipantsChanged(params.channelId, data);
      },
    });

    const connection: ActiveConnection = {
      socketClient,
      ecies,
      keyExchange,
      dappInfo,
      channelId: params.channelId,
    };

    this.connections.set(params.channelId, connection);

    // Save initial session
    const activeAccount = store.zondStore.activeAccount?.accountAddress || '';
    const session: DAppSession = {
      id: params.channelId,
      dappInfo,
      connectedAccount: activeAccount,
      privateKey: ecies.getPrivateKeyHex(),
      otherPublicKey: params.pubKey,
      relayUrl: params.relay,
      status: SessionStatus.CONNECTING,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    SessionStore.save(session);
    this.handlers?.onSessionsChanged();

    // Connect to relay
    try {
      dlog(`Connecting to relay: ${params.relay}`);
      socketClient.connect();
      const { bufferedMessages } = await socketClient.joinChannel(params.channelId);
      dlog(`joinChannel returned ${bufferedMessages.length} buffered message(s)`);

      // Process buffered messages
      for (const msg of bufferedMessages) {
        this.handleRelayMessage(params.channelId, msg as RelayMessage);
      }

      return { success: true };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      dlog(`Connection failed: ${errMsg}`);
      this.connections.delete(params.channelId);
      SessionStore.remove(params.channelId);
      this.handlers?.onSessionsChanged();
      return { success: false, error: errMsg };
    }
  }

  /**
   * Called when key exchange completes for a session.
   */
  private onKeysExchanged(channelId: string): void {
    dlog(`Keys exchanged for channel ${channelId}`);

    const conn = this.connections.get(channelId);
    if (!conn) return;

    SessionStore.updateStatus(channelId, SessionStatus.CONNECTED);

    // Update stored other public key
    const session = SessionStore.get(channelId);
    if (session) {
      session.otherPublicKey = conn.keyExchange.getOtherPublicKey();
      session.status = SessionStatus.CONNECTED;
      SessionStore.save(session);
    }

    // Send wallet info to dApp
    const activeAccount = store.zondStore.activeAccount?.accountAddress || '';
    this.sendEncrypted(channelId, {
      type: MessageType.WALLET_INFO,
      accounts: activeAccount ? [activeAccount] : [],
      chainId: conn.dappInfo.chainId,
    });

    this.handlers?.onSessionConnected(channelId);
    this.handlers?.onSessionsChanged();

    // Notify native app
    if (isInNativeApp()) {
      sendToNative('DAPP_CONNECTED' as never, {
        name: conn.dappInfo.name,
        url: conn.dappInfo.url,
        channelId,
        connectedAccount: activeAccount,
      });
      triggerHaptic('success');
    }
  }

  /**
   * Handle an incoming relay message for a specific channel.
   */
  private handleRelayMessage(channelId: string, data: RelayMessage): void {
    const conn = this.connections.get(channelId);
    if (!conn) {
      dlog(`handleRelayMessage: no connection found for ${channelId} - ignoring`);
      return;
    }

    const message = data.message;

    // Key exchange messages (plaintext objects)
    if (typeof message === 'object' && message !== null) {
      const msg = message as { type?: string; pubkey?: string; v?: number };
      if (
        msg.type === KeyExchangeMessageType.SYN ||
        msg.type === KeyExchangeMessageType.SYNACK ||
        msg.type === KeyExchangeMessageType.ACK
      ) {
        dlog(`Key exchange message: ${msg.type}`);
        try {
          const response = conn.keyExchange.onMessage(msg as {
            type: KeyExchangeMessageType;
            pubkey?: string;
            v?: number;
          });
          if (response) {
            dlog(`Sending key exchange response: ${(response as { type?: string }).type}`);
            this.sendPlaintext(channelId, response);
          }
        } catch (err) {
          dlog(`Key exchange failed: ${err instanceof Error ? err.message : String(err)}`);
          this.disconnectSession(channelId);
        }
        return;
      }
    }

    // Encrypted messages (base64 strings)
    if (typeof message === 'string' && conn.keyExchange.areKeysExchanged()) {
      try {
        const decrypted = conn.keyExchange.decryptMessage(message);
        const parsed = JSON.parse(decrypted);
        this.handleDecryptedMessage(channelId, parsed);
      } catch (err) {
        console.error('[DAppConnect] Failed to decrypt message:', err);
      }
    }
  }

  /**
   * Handle a decrypted message from the dApp.
   */
  private handleDecryptedMessage(channelId: string, msg: Record<string, unknown>): void {
    const conn = this.connections.get(channelId);
    if (!conn) return;

    const type = msg.type as string;

    switch (type) {
      case MessageType.ORIGINATOR_INFO: {
        // Update dApp info if provided
        const info = msg.originatorInfo as DAppInfo | undefined;
        if (info) {
          conn.dappInfo.name = info.name || conn.dappInfo.name;
          conn.dappInfo.url = info.url || conn.dappInfo.url;
          conn.dappInfo.icon = info.icon || conn.dappInfo.icon;
          this.handlers?.onSessionsChanged();
        }
        break;
      }

      case MessageType.JSONRPC: {
        const method = msg.method as string;
        const id = msg.id as string | number;
        const params = msg.params as unknown[] | undefined;

        if (!method) return;

        if (!RequestHandler.isKnownMethod(method)) {
          // Unknown method - send error back
          this.sendJsonRpcResponse(channelId, {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          });
          return;
        }

        if (RequestHandler.isRestricted(method)) {
          // Queue for user approval
          const pendingRequest = RequestHandler.createPendingRequest(
            channelId,
            { method, params, id },
            conn.dappInfo
          );

          this.handlers?.onPendingRequest(pendingRequest);

          // Tell native to show WebView if user might be on another tab
          if (isInNativeApp()) {
            sendToNative('DAPP_SHOW_WEBVIEW' as never, {
              name: conn.dappInfo.name,
              method,
            });
            triggerHaptic('warning');
          }
        } else {
          // Unrestricted methods - proxy through our web3 instance
          this.proxyRpcRequest(channelId, id, method, params);
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

  /**
   * Proxy an unrestricted RPC request through our web3 instance.
   */
  private async proxyRpcRequest(
    channelId: string,
    id: string | number,
    method: string,
    params?: unknown[]
  ): Promise<void> {
    try {
      const web3 = store.zondStore.zondInstance;
      if (!web3) {
        throw new Error('Web3 not initialized');
      }
      const provider = getRequestProvider(web3);
      if (!provider) {
        throw new Error('Web3 provider does not support request()');
      }

      // Use the web3 provider to forward the request
      const result = await provider.request({ method, params });

      this.sendJsonRpcResponse(channelId, {
        jsonrpc: '2.0',
        id,
        result,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.sendJsonRpcResponse(channelId, {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: errMsg },
      });
    }
  }

  /**
   * Approve a pending request. Called from the approval UI.
   */
  approveRequest(sessionId: string, requestId: string | number, result: unknown): void {
    this.sendJsonRpcResponse(sessionId, {
      jsonrpc: '2.0',
      id: requestId,
      result,
    });

    if (isInNativeApp()) {
      triggerHaptic('success');
    }
  }

  /**
   * Reject a pending request. Called from the approval UI.
   */
  rejectRequest(sessionId: string, requestId: string | number, message = 'User rejected the request'): void {
    this.sendJsonRpcResponse(sessionId, {
      jsonrpc: '2.0',
      id: requestId,
      error: { code: 4001, message },
    });

    if (isInNativeApp()) {
      triggerHaptic('error');
    }
  }

  /**
   * Disconnect a specific session.
   */
  disconnectSession(channelId: string, explicit = true): void {
    dlog(`disconnectSession called for ${channelId}`);
    dlog(`Call stack: ${new Error().stack?.split('\n').slice(1, 5).join(' <- ')}`);
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

    try {
      const encrypted = conn.keyExchange.encryptMessage(JSON.stringify({ type: MessageType.TERMINATE }));
      const sendPromise = conn.socketClient
        .sendMessage({
          id: channelId,
          clientType: 'wallet',
          message: encrypted,
        })
        .catch((err) => {
          console.error('[DAppConnect] Failed to send terminate:', err);
        });

      void Promise.race([
        sendPromise,
        new Promise((resolve) => setTimeout(resolve, TERMINATE_SEND_TIMEOUT_MS)),
      ]).finally(() => {
        finalize();
      });
    } catch {
      // Best effort
      finalize();
    }
  }

  /**
   * Get all active sessions.
   */
  getActiveSessions(): DAppSession[] {
    return SessionStore.getAll();
  }

  /**
   * Reconnect all stored sessions (called on app launch / foreground).
   */
  async reconnectAll(): Promise<void> {
    dlog(`reconnectAll called`);
    // Clear any pending stale-session timers (wallet returning from background
    // should not auto-disconnect sessions that were waiting for dApp rejoin)
    for (const channelId of this.dappLeaveTimers.keys()) {
      this.clearDappLeaveTimeout(channelId);
    }
    const sessions = SessionStore.getAll();
    for (const session of sessions) {
      if (this.connections.has(session.id)) continue; // Already connected

      try {
        // Reconstruct the connection
        const ecies = new ECIESManager(session.privateKey);
        const keyExchange = new KeyExchange(
          ecies,
          session.otherPublicKey || undefined,
          () => this.onKeysExchanged(session.id),
          { keysAlreadyExchanged: Boolean(session.otherPublicKey) }
        );

        const socketClient = new SocketClient(session.relayUrl || DEFAULT_RELAY_URL, {
          onMessage: (data) => {
            if (data.clientType === 'dapp') {
              this.clearDappLeaveTimeout(session.id);
            }
            this.handleRelayMessage(session.id, data);
          },
          onConnected: () => console.log('[DAppConnect] Reconnected to relay for', session.dappInfo.name),
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
        });

        this.connections.set(session.id, {
          socketClient,
          ecies,
          keyExchange,
          dappInfo: session.dappInfo,
          channelId: session.id,
        });

        socketClient.connect();
        const { bufferedMessages } = await socketClient.joinChannel(session.id);

        // Process any buffered messages
        for (const msg of bufferedMessages) {
          this.handleRelayMessage(session.id, msg as RelayMessage);
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

  /**
   * Disconnect all sessions.
   */
  disconnectAll(): void {
    dlog(`disconnectAll called with ${this.connections.size} connections`);
    for (const channelId of this.connections.keys()) {
      this.disconnectSession(channelId);
    }
  }

  /**
   * Check if a URI is a qrlconnect:// URI.
   */
  static isConnectionURI(uri: string): boolean {
    return /^qrlconnect:/i.test(uri);
  }

  // --- Private helpers ---

  private handleParticipantsChanged(channelId: string, data: { event: string; clientType?: string }): void {
    dlog(`Participants changed: ${data.event} (${data.clientType || 'unknown'})`);

    if (data.event === 'join' && data.clientType === 'dapp') {
      this.clearDappLeaveTimeout(channelId);
      return;
    }

    if ((data.event === 'disconnect' || data.event === 'leave') && (data.clientType === 'dapp' || !data.clientType)) {
      this.scheduleDappLeaveTimeout(channelId);
    }
  }

  private scheduleDappLeaveTimeout(channelId: string): void {
    this.clearDappLeaveTimeout(channelId);
    const timeout = setTimeout(() => {
      this.dappLeaveTimers.delete(channelId);
      if (!this.connections.has(channelId)) return;
      dlog(`dApp absent for ${DAPP_REJOIN_GRACE_MS}ms; disconnecting stale session`);
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

  private sendPlaintext(channelId: string, message: object): Promise<void> {
    const conn = this.connections.get(channelId);
    if (!conn) return Promise.resolve();

    return conn.socketClient.sendMessage({
      id: channelId,
      clientType: 'wallet',
      message,
    });
  }

  private sendEncrypted(channelId: string, message: object): void {
    const conn = this.connections.get(channelId);
    if (!conn) return;

    try {
      const encrypted = conn.keyExchange.encryptMessage(JSON.stringify(message));
      conn.socketClient.sendMessage({
        id: channelId,
        clientType: 'wallet',
        message: encrypted,
      }).catch((err) => {
        console.error('[DAppConnect] Failed to send encrypted:', err);
      });
    } catch (err) {
      console.error('[DAppConnect] Encryption failed:', err);
    }
  }

  private sendJsonRpcResponse(channelId: string, response: JsonRpcResponse): void {
    this.sendEncrypted(channelId, {
      type: MessageType.JSONRPC,
      ...response,
    });
  }
}

// Singleton
export const dappConnectService = new DAppConnectService();
