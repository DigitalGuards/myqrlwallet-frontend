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

  constructor(relayUrl: string, handlers: SocketEventHandler) {
    this.relayUrl = relayUrl;
    this.handlers = handlers;
  }

  connect(): void {
    if (this.socket?.connected) return;

    this.socket = io(this.relayUrl, {
      path: RELAY_PATH,
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
    });

    this.socket.on('connect', () => {
      this.handlers.onConnected();

      // Re-join channel on reconnect
      if (this.channelId) {
        this.joinChannel(this.channelId).then(({ bufferedMessages }) => {
          // Deliver buffered messages that arrived while disconnected
          for (const msg of bufferedMessages) {
            this.handlers.onMessage(msg as RelayMessage);
          }
          this.handlers.onReconnected();
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
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        this.channelId = channelId;
        resolve({ bufferedMessages: [] });
        return;
      }

      this.channelId = channelId;

      this.socket.emit(
        'join_channel',
        { channelId, clientType: 'wallet' },
        (response: { success: boolean; error?: string; bufferedMessages?: unknown[] }) => {
          if (response.success) {
            resolve({ bufferedMessages: response.bufferedMessages || [] });
          } else {
            reject(new Error(response.error || 'Failed to join channel'));
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
