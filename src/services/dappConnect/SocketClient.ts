/**
 * Socket.IO client for the wallet side of the relay.
 */

import type { Socket } from 'socket.io-client';
import type { RelayMessage } from './types';
import { logToNative } from '@/utils/nativeApp';

const RELAY_PATH = '/relay';
// Give an outbound leave/close packet a bounded window to reach the relay
// (resolving on its ack) before the socket is torn down, so disconnect() can't
// drop the unflushed packet and lose the tombstone / leave notification.
const SEND_FLUSH_TIMEOUT_MS = 600;

type SocketEventHandler = {
  onMessage: (data: RelayMessage) => void;
  onConnected: () => void;
  onDisconnected: (reason: string) => void;
  onReconnected: () => void;
  onParticipantsChanged: (data: { event: string; clientType?: string }) => void;
  /** The relay reported a terminated (tombstoned) channel on (re)join. */
  onTerminated?: () => void;
};

export class SocketClient {
  private socket: Socket | null = null;
  private relayUrl: string;
  private channelId: string | null = null;
  private handlers: SocketEventHandler;
  private hasJoinedOnce = false;

  constructor(relayUrl: string, handlers: SocketEventHandler) {
    this.relayUrl = relayUrl;
    this.handlers = handlers;
  }

  private _connecting = false;

  async connect(): Promise<void> {
    if (this.socket?.connected || this._connecting) return;
    this._connecting = true;
    let ioFn: typeof import('socket.io-client')['io'];
    try {
      ioFn = (await import('socket.io-client')).io;
    } catch (e) {
      this._connecting = false;
      throw e;
    }
    // Another call may have raced past the guard while we awaited the import
    if (this.socket?.connected) { this._connecting = false; return; }
    this.socket = ioFn(this.relayUrl, {
      path: RELAY_PATH,
      // Polling-first so Cloudflare can negotiate any challenge/cookie
      // handshake at the HTTP layer before auto-upgrading to WS.
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
    });

    this._connecting = false;

    this.socket.on('connect', () => {
      this.handlers.onConnected();

      // Auto-rejoin only after the initial join has succeeded. The initial
      // join is driven by the caller via joinChannel(); otherwise we'd race
      // with it here and emit join_channel twice on the first connect.
      if (this.channelId && this.hasJoinedOnce) {
        this.emitJoinChannel(this.channelId)
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

    this.socket.on('disconnect', (reason) => {
      this.handlers.onDisconnected(reason);
    });

    this.socket.on('message', (data: RelayMessage) => {
      this.handlers.onMessage(data);
    });

    this.socket.on('participants_changed', (data) => {
      this.handlers.onParticipantsChanged(data);
    });

    this.socket.on('connect_error', (err) => {
      console.warn('[SocketClient] Connection error:', err.message);
      logToNative(`[SocketClient] connect_error: ${err.message}`);
    });
  }

  async joinChannel(
    channelId: string
  ): Promise<{ bufferedMessages: unknown[]; channelPublicKey: string | null; terminated: boolean }> {
    this.channelId = channelId;
    if (!this.socket) {
      throw new Error('Socket not initialised; call connect() before joinChannel()');
    }
    if (!this.socket.connected) {
      // Match the socket.io `timeout` above; a shorter wait here would
      // reject joinChannel while the underlying socket is still legitimately
      // trying to connect, corrupting our session state.
      await this.waitForConnect(20000);
    }
    const result = await this.emitJoinChannel(channelId);
    this.hasJoinedOnce = true;
    return result;
  }

  private waitForConnect(timeoutMs: number): Promise<void> {
    const socket = this.socket!;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
      };
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Socket connect timeout'));
      }, timeoutMs);
      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
    });
  }

  private emitJoinChannel(
    channelId: string
  ): Promise<{ bufferedMessages: unknown[]; channelPublicKey: string | null; terminated: boolean }> {
    return new Promise((resolve, reject) => {
      this.socket!.emit(
        'join_channel',
        { channelId, clientType: 'wallet' },
        (response: {
          success: boolean;
          error?: string;
          bufferedMessages?: unknown[];
          channelPublicKey?: string | null;
          terminated?: boolean;
        }) => {
          if (response?.success) {
            resolve({
              bufferedMessages: response.bufferedMessages || [],
              channelPublicKey: response.channelPublicKey ?? null,
              terminated: response.terminated === true,
            });
          } else {
            reject(new Error(response?.error || 'Failed to join channel'));
          }
        }
      );
    });
  }

  sendMessage(data: RelayMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Socket not connected'));
        return;
      }

      this.socket.emit('message', data, (response: { success: boolean; error?: string }) => {
        if (response?.success) {
          resolve();
        } else {
          reject(new Error(response?.error || 'Failed to send'));
        }
      });
    });
  }

  /**
   * Emit an event and resolve once the relay acks it, or after a bounded
   * flush window. Lets a caller await transmission before tearing the socket
   * down (socket.io buffers emits, and disconnect() drops anything unflushed).
   */
  private flushEmit(event: string, payload: object): Promise<void> {
    return new Promise((resolve) => {
      if (!this.socket?.connected) {
        resolve();
        return;
      }
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(done, SEND_FLUSH_TIMEOUT_MS);
      this.socket.emit(event, payload, () => {
        clearTimeout(timer);
        done();
      });
    });
  }

  leaveChannel(): Promise<void> {
    const channelId = this.channelId;
    this.channelId = null;
    if (!this.socket?.connected || !channelId) return Promise.resolve();
    return this.flushEmit('leave_channel', { channelId });
  }

  /**
   * Explicitly terminate the channel on the relay (intentional disconnect /
   * "forget"), as opposed to a transient leave. The relay marks a durable
   * tombstone so the dApp learns the session is dead even if it is not
   * currently joined and only re-joins later. Resolves once the close is
   * flushed (or times out) so the caller can safely disconnect afterwards.
   */
  closeChannel(): Promise<void> {
    const channelId = this.channelId;
    this.channelId = null;
    if (!this.socket?.connected || !channelId) return Promise.resolve();
    return this.flushEmit('close_channel', { channelId });
  }

  disconnect(): void {
    this.channelId = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}
