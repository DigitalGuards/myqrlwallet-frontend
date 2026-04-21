/**
 * Socket.IO client for the wallet side of the relay.
 */

import { io, Socket } from 'socket.io-client';
import type { RelayMessage } from './types';
import { logToNative } from '@/utils/nativeApp';

const RELAY_PATH = '/relay';

type SocketEventHandler = {
  onMessage: (data: RelayMessage) => void;
  onConnected: () => void;
  onDisconnected: (reason: string) => void;
  onReconnected: () => void;
  onParticipantsChanged: (data: { event: string; clientType?: string }) => void;
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

  connect(): void {
    if (this.socket?.connected) return;

    this.socket = io(this.relayUrl, {
      path: RELAY_PATH,
      // Polling-first: Cloudflare's cold-path handshake (especially after an
      // iOS WebView swipe-kill relaunch) can challenge/redirect at the HTTP
      // layer, which polling handles cleanly but a direct WS upgrade can't.
      // After polling succeeds, socket.io auto-upgrades to WS anyway.
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
      // Need enough headroom for a CF cold path (observed ~60s worst case)
      // + the server-side pingTimeout (20s) that has to expire before the
      // stale wallet socket from the killed process is evicted and we can
      // re-take the wallet slot in the channel.
      timeout: 60000,
    });

    this.socket.on('connect', () => {
      this.handlers.onConnected();

      // Auto-rejoin only after the initial join has succeeded. The initial
      // join is driven by the caller via joinChannel(); otherwise we'd race
      // with it here and emit join_channel twice on the first connect.
      if (this.channelId && this.hasJoinedOnce) {
        this.emitJoinChannel(this.channelId)
          .then(({ bufferedMessages }) => {
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

  async joinChannel(channelId: string): Promise<{ bufferedMessages: unknown[] }> {
    this.channelId = channelId;
    if (!this.socket) {
      throw new Error('Socket not initialised; call connect() before joinChannel()');
    }
    if (!this.socket.connected) {
      // Match the socket.io `timeout` above; a shorter wait here would
      // reject joinChannel while the underlying socket is still legitimately
      // trying to connect, corrupting our session state.
      await this.waitForConnect(60000);
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

  private emitJoinChannel(channelId: string): Promise<{ bufferedMessages: unknown[] }> {
    return new Promise((resolve, reject) => {
      this.socket!.emit(
        'join_channel',
        { channelId, clientType: 'wallet' },
        (response: { success: boolean; error?: string; bufferedMessages?: unknown[] }) => {
          if (response?.success) {
            resolve({ bufferedMessages: response.bufferedMessages || [] });
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

  leaveChannel(): void {
    if (this.socket?.connected && this.channelId) {
      this.socket.emit('leave_channel', { channelId: this.channelId });
    }
    this.channelId = null;
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
