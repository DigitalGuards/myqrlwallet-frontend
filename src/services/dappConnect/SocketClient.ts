/**
 * Socket.IO client for the wallet side of the relay.
 */

import type { Socket } from 'socket.io-client';
import type { RelayMessage } from './types';
import { logToNative } from '@/utils/nativeApp';

type SocketIoLoader = () => Promise<Pick<typeof import('socket.io-client'), 'io'>>;
const defaultSocketIoLoader: SocketIoLoader = () => import('socket.io-client');
let socketIoLoader: SocketIoLoader = defaultSocketIoLoader;

/** Test-only seam for holding the dynamic import across a lifecycle cancel. */
export function _setSocketIoLoaderForTests(loader?: SocketIoLoader): void {
  socketIoLoader = loader ?? defaultSocketIoLoader;
}

const RELAY_PATH = '/relay';
// Give an outbound leave/close packet a bounded window to reach the relay
// (resolving on its ack) before the socket is torn down, so disconnect() can't
// drop the unflushed packet and lose the tombstone / leave notification.
const SEND_FLUSH_TIMEOUT_MS = 600;
export const RELAY_ACK_TIMEOUT_MS = 10000;
const MAX_BUFFERED_MESSAGES = 50;
const MAX_CHANNEL_PUBLIC_KEY_B64_LEN = 2048;
const MAX_RELAY_ERROR_LENGTH = 256;
const MAX_RELAY_MESSAGE_STRING_LENGTH = 256 * 1024;

type ParticipantChange = {
  event: 'join' | 'leave' | 'disconnect' | 'close';
  clientType: 'dapp';
};

interface JoinChannelResult {
  bufferedMessages: RelayMessage[];
  channelPublicKey: string | null;
  terminated: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRelayMessage(value: unknown): value is RelayMessage {
  if (!isRecord(value)) return false;
  const message = value['message'];
  return (
    typeof value['id'] === 'string' &&
    value['id'].length > 0 &&
    value['id'].length <= 128 &&
    (value['clientType'] === 'dapp' || value['clientType'] === 'wallet') &&
    ((typeof message === 'string' &&
      message.length <= MAX_RELAY_MESSAGE_STRING_LENGTH) ||
      isRecord(message))
  );
}

function parseJoinResponse(response: unknown): JoinChannelResult {
  if (!isRecord(response) || response['success'] !== true) {
    const error =
      isRecord(response) &&
      typeof response['error'] === 'string' &&
      response['error'].length <= MAX_RELAY_ERROR_LENGTH
      ? response['error']
      : 'Failed to join channel';
    throw new Error(error);
  }
  const rawMessages = response['bufferedMessages'];
  if (!Array.isArray(rawMessages)) {
    throw new Error('Relay returned malformed buffered messages');
  }
  const bufferedMessages = rawMessages;
  if (bufferedMessages.length > MAX_BUFFERED_MESSAGES) {
    throw new Error('Relay returned too many buffered messages');
  }
  if (!bufferedMessages.every(isRelayMessage)) {
    throw new Error('Relay returned a malformed buffered message');
  }

  const rawPublicKey = response['channelPublicKey'];
  if (
    rawPublicKey !== undefined &&
    rawPublicKey !== null &&
    (typeof rawPublicKey !== 'string' || rawPublicKey.length > MAX_CHANNEL_PUBLIC_KEY_B64_LEN)
  ) {
    throw new Error('Relay returned a malformed channel public key');
  }
  if (typeof response['terminated'] !== 'boolean') {
    throw new Error('Relay returned a malformed termination status');
  }

  return {
    bufferedMessages,
    channelPublicKey: typeof rawPublicKey === 'string' ? rawPublicKey : null,
    terminated: response['terminated'],
  };
}

type SocketEventHandler = {
  onMessage: (data: RelayMessage) => void;
  onConnected: () => void;
  onDisconnected: (reason: string) => void;
  onReconnected: () => void;
  onParticipantsChanged: (data: ParticipantChange) => void;
  /** The relay reported a terminated (tombstoned) channel on (re)join. */
  onTerminated?: () => void;
};

export class SocketClient {
  private socket: Socket | null = null;
  private connectedAt: number | null = null;
  private relayUrl: string;
  private channelId: string | null = null;
  private handlers: SocketEventHandler;
  private hasJoinedOnce = false;
  private lifecycleGeneration = 0;
  private readonly pendingConnectCancellations = new Set<() => void>();

  constructor(relayUrl: string, handlers: SocketEventHandler) {
    this.relayUrl = relayUrl;
    this.handlers = handlers;
  }

  // In-flight connect, memoized so concurrent callers all await the SAME
  // attempt instead of returning early while this.socket is still null
  // (a boolean guard let a second caller race past and hit joinChannel on
  // an uninitialized socket).
  private connectPromise: Promise<void> | null = null;
  private joinPromise: Promise<JoinChannelResult> | null = null;
  private joiningChannelId: string | null = null;

  connect(): Promise<void> {
    if (this.socket?.connected) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    const generation = this.lifecycleGeneration;
    const task = this.doConnect(generation).finally(() => {
      if (this.connectPromise === task) this.connectPromise = null;
    });
    this.connectPromise = task;
    return task;
  }

  private assertLifecycleCurrent(generation: number): void {
    if (generation !== this.lifecycleGeneration) {
      throw new Error('Socket connection cancelled');
    }
  }

  private async doConnect(generation: number): Promise<void> {
    this.assertLifecycleCurrent(generation);
    const existing = this.socket;
    if (existing) {
      if (existing.connected) return;
      await this.waitForConnect(existing, 20000, generation);
      this.assertLifecycleCurrent(generation);
      return;
    }
    const ioFn = (await socketIoLoader()).io;
    this.assertLifecycleCurrent(generation);
    // A prior attempt may have finished while we awaited the import
    if (this.socket) {
      if (!this.socket.connected) {
        await this.waitForConnect(this.socket, 20000, generation);
      }
      this.assertLifecycleCurrent(generation);
      return;
    }
    const socket = ioFn(this.relayUrl, {
      path: RELAY_PATH,
      // Websocket-first, matching the dApp SDK. Long-poll XHRs are killed
      // when native UI transitions interrupt the WebView (tab switch on
      // DAPP_SHOW_WEBVIEW, haptics, backgrounding), surfacing as periodic
      // "transport error" flaps on device; a single WS survives those
      // pauses. Cloudflare clearance is already established by the page
      // load itself, so the old polling-first challenge rationale no
      // longer applies; socket.io still falls back to polling if WSS is
      // blocked.
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.connectedAt = Date.now();
      logToNative(`[SocketClient] connected via ${this.transportName()}`);
      this.handlers.onConnected();

      // Auto-rejoin only after the initial join has succeeded. The initial
      // join is driven by the caller via joinChannel(); otherwise we'd race
      // with it here and emit join_channel twice on the first connect.
      const socket = this.socket;
      if (this.channelId && this.hasJoinedOnce && socket) {
        this.emitJoinChannel(socket, this.channelId)
          .then(({ bufferedMessages, terminated }) => {
            if (terminated) {
              // The dApp explicitly closed the channel while we were away.
              // Don't deliver stale buffered messages or flip back to
              // CONNECTED; surface the termination so the session is dropped.
              this.handlers.onTerminated?.();
              return;
            }
            for (const msg of bufferedMessages) {
              this.handlers.onMessage(msg as RelayMessage);
            }
            this.handlers.onReconnected();
          })
          .catch((err) => {
            console.warn('[SocketClient] Auto-rejoin failed:', err?.message ?? err);
          });
      }
    });

    socket.on('disconnect', (reason, description) => {
      // Diagnostic context for on-device transport flaps: which transport
      // died, how long it lived, what the engine said, and whether the
      // WebView was visible at that instant.
      const aliveMs = this.connectedAt ? Date.now() - this.connectedAt : -1;
      this.connectedAt = null;
      let detail = '';
      if (description instanceof Error) {
        detail = description.message;
      } else if (description && typeof description === 'object') {
        const rec: Record<string, unknown> = { ...description };
        if (typeof rec['description'] === 'string') detail = rec['description'];
        else if (typeof rec['type'] === 'string') detail = rec['type'];
      }
      const visible =
        typeof document !== 'undefined' ? document.visibilityState : 'n/a';
      const online = typeof navigator !== 'undefined' ? String(navigator.onLine) : 'n/a';
      logToNative(
        `[SocketClient] disconnect: ${reason}; detail=${detail || 'none'}; ` +
          `transport=${this.transportName()}; aliveMs=${aliveMs}; ` +
          `visible=${visible}; online=${online}`
      );
      this.handlers.onDisconnected(reason);
    });

    socket.on('message', (data: RelayMessage) => {
      this.handlers.onMessage(data);
    });

    socket.on('participants_changed', (data: unknown) => {
      if (!isRecord(data)) return;
      const event = data['event'];
      if (
        (event !== 'join' &&
          event !== 'leave' &&
          event !== 'disconnect' &&
          event !== 'close') ||
        data['clientType'] !== 'dapp'
      ) {
        return;
      }
      this.handlers.onParticipantsChanged({ event, clientType: 'dapp' });
    });

    socket.on('connect_error', (err) => {
      console.warn('[SocketClient] Connection error:', err.message);
      logToNative(`[SocketClient] connect_error: ${err.message}`);
    });
    if (!socket.connected) await this.waitForConnect(socket, 20000, generation);
    this.assertLifecycleCurrent(generation);
  }

  async joinChannel(
    channelId: string
  ): Promise<JoinChannelResult> {
    if (this.joinPromise) {
      if (this.joiningChannelId !== channelId) {
        throw new Error('A different relay channel join is already in progress');
      }
      return this.joinPromise;
    }
    this.joiningChannelId = channelId;
    const task = this.joinChannelNow(channelId).finally(() => {
      if (this.joinPromise === task) {
        this.joinPromise = null;
        this.joiningChannelId = null;
      }
    });
    this.joinPromise = task;
    return task;
  }

  private async joinChannelNow(channelId: string): Promise<JoinChannelResult> {
    this.channelId = channelId;
    const socket = this.socket;
    if (!socket) {
      throw new Error('Socket not initialised; call connect() before joinChannel()');
    }
    if (!socket.connected) {
      // Match the socket.io `timeout` above; a shorter wait here would
      // reject joinChannel while the underlying socket is still legitimately
      // trying to connect, corrupting our session state.
      await this.waitForConnect(socket, 20000, this.lifecycleGeneration);
    }
    const result = await this.emitJoinChannel(socket, channelId);
    this.hasJoinedOnce = true;
    return result;
  }

  private waitForConnect(
    socket: Socket,
    timeoutMs: number,
    generation: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
        this.pendingConnectCancellations.delete(onCancelled);
      };
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onCancelled = () => {
        cleanup();
        reject(new Error('Socket connection cancelled'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Socket connect timeout'));
      }, timeoutMs);
      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
      if (generation !== this.lifecycleGeneration) {
        onCancelled();
      } else {
        this.pendingConnectCancellations.add(onCancelled);
      }
    });
  }

  private emitJoinChannel(
    socket: Socket,
    channelId: string
  ): Promise<JoinChannelResult> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | null, result?: JoinChannelResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result as JoinChannelResult);
      };
      const timer = setTimeout(
        () => finish(new Error('Relay join acknowledgement timeout')),
        RELAY_ACK_TIMEOUT_MS
      );
      try {
        socket.emit(
          'join_channel',
          { channelId, clientType: 'wallet' },
          (response: unknown) => {
            try {
              finish(null, parseJoinResponse(response));
            } catch (error) {
              finish(error instanceof Error ? error : new Error(String(error)));
            }
          }
        );
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  sendMessage(data: RelayMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Socket not connected'));
        return;
      }
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(new Error('Relay send acknowledgement timeout')),
        RELAY_ACK_TIMEOUT_MS
      );
      try {
        this.socket.emit('message', data, (response: unknown) => {
          if (isRecord(response) && response['success'] === true) {
            finish();
          } else {
            const message =
              isRecord(response) &&
              typeof response['error'] === 'string' &&
              response['error'].length <= MAX_RELAY_ERROR_LENGTH
                ? response['error']
                : 'Failed to send';
            finish(new Error(message));
          }
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Emit an event and resolve once the relay acks it, or after a bounded
   * flush window. Lets a caller await transmission before tearing the socket
   * down (socket.io buffers emits, and disconnect() drops anything unflushed).
   */
  private flushEmit(
    event: 'leave_channel' | 'close_channel',
    payload: object,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.socket?.connected) {
        resolve(false);
        return;
      }
      let settled = false;
      const done = (success: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(success);
      };
      const timer = setTimeout(() => done(false), SEND_FLUSH_TIMEOUT_MS);
      try {
        this.socket.emit(event, payload, (response: unknown) => {
          done(
            isRecord(response) &&
              response['success'] === true &&
              (event !== 'close_channel' || response['terminated'] === true),
          );
        });
      } catch {
        done(false);
      }
    });
  }

  leaveChannel(): Promise<boolean> {
    const channelId = this.channelId;
    this.channelId = null;
    if (!this.socket?.connected || !channelId) return Promise.resolve(false);
    return this.flushEmit('leave_channel', { channelId });
  }

  /**
   * Explicitly terminate the channel on the relay (intentional disconnect /
   * "forget"), as opposed to a transient leave. The relay marks a durable
   * tombstone so the dApp learns the session is dead even if it is not
   * currently joined and only re-joins later. Resolves once the close is
   * flushed (or times out) so the caller can safely disconnect afterwards.
   */
  closeChannel(channelOverride?: string): Promise<boolean> {
    const channelId = channelOverride ?? this.channelId;
    this.channelId = null;
    if (!this.socket?.connected || !channelId) return Promise.resolve(false);
    return this.flushEmit('close_channel', { channelId });
  }

  disconnect(): void {
    this.lifecycleGeneration += 1;
    for (const cancel of [...this.pendingConnectCancellations]) cancel();
    this.pendingConnectCancellations.clear();
    this.connectPromise = null;
    this.channelId = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private transportName(): string {
    return this.socket?.io.engine?.transport?.name ?? 'unknown';
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}
