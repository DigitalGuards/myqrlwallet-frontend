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
  /**
   * The relay disconnected this socket and it will not come back. Anything
   * held for the channel is undeliverable, so the session should be retired.
   */
  onReconnectAbandoned?: () => void;
  /**
   * The socket is up but the relay would not take the channel back, and the
   * retries are spent. Nothing can be sent or received on it, so the session
   * must be retired rather than left looking live.
   */
  onRejoinAbandoned?: () => void;
  onParticipantsChanged: (data: ParticipantChange) => void;
  /** The relay reported a terminated (tombstoned) channel on (re)join. */
  onTerminated?: () => void;
};

/**
 * The socket was known to be down before anything was emitted.
 *
 * Distinct from every other send failure: a rejected or missing relay
 * acknowledgement is ambiguous, because the relay may have accepted the frame
 * without the wallet seeing the ack, while this one cannot have been seen by
 * anyone.
 */
export class SocketNotConnectedError extends Error {
  constructor(message = 'Socket not connected') {
    super(message);
    this.name = 'SocketNotConnectedError';
  }
}

/**
 * The socket is up and the relay does not have it in the channel.
 *
 * A subclass, so every caller that already treats SocketNotConnectedError as
 * "nothing left this process, hold it" keeps working unchanged, while a caller
 * that wants to tell the two apart can.
 */
export class RelayChannelNotJoinedError extends SocketNotConnectedError {
  constructor(message = 'Relay channel not joined') {
    super(message);
    this.name = 'RelayChannelNotJoinedError';
  }
}

/**
 * Relay acknowledgement errors that are refusals BEFORE anything is delivered
 * or buffered, and that a rejoin can clear.
 *
 * `channelManager.routeMessage` returns both of these before it touches any
 * channel state: the channel lookup and the participant lookup come first, so
 * no message was routed, none was buffered, and no replay sequence was
 * recorded. Re-sending the identical sealed bytes at the same counter is
 * therefore correct, and the peer's AEAD stream stays contiguous.
 *
 * Nothing else is on this list on purpose. A replay rejection may mean an
 * earlier copy did land, and "Counterparty transport unavailable" is raised
 * after routing has already been decided, so both stay ambiguous and keep
 * failing closed.
 */
const MEMBERSHIP_REFUSALS = new Set([
  'Sender not in channel',
  'Channel not found',
]);

/** Retries after a server-initiated disconnect, and the first delay. */
const MANUAL_RECONNECT_ATTEMPTS = 4;
const MANUAL_RECONNECT_BASE_MS = 1_000;

/**
 * Retries for a refused rejoin, and the first delay.
 *
 * Both refusals the relay actually issues are transient by construction. A
 * stale wallet participant is held for at most its ping interval plus its ping
 * timeout, and the join rate limit is a one-minute window. Six attempts from
 * one second, doubling and capped, span both.
 */
const REJOIN_ATTEMPTS = 6;
const REJOIN_BASE_MS = 1_000;
const REJOIN_MAX_DELAY_MS = 20_000;

export class SocketClient {
  private socket: Socket | null = null;
  /** Manual retries after a server-initiated disconnect. */
  private manualReconnectAttempts = 0;
  private manualReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The relay has this socket in the channel.
   *
   * Socket-level connectedness is not channel membership: a reconnected socket
   * is `connected` a whole relay round trip before its rejoin is acknowledged,
   * and a refused rejoin leaves it connected and never a member. The relay
   * answers a frame from a non-member with an error, which the caller cannot
   * tell apart from a genuinely ambiguous acknowledgement, so it spends a
   * counter and then retires the pairing. Membership is tracked here instead.
   */
  private joined = false;
  private rejoinAttempts = 0;
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null;
  /** A rejoin is on the wire and its acknowledgement is still outstanding. */
  private rejoinInFlight = false;
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
      // The budget is NOT reset here. The relay refuses inside its own
      // connection handler, so a refused socket still sees `connect` first:
      // resetting on connect made the budget unreachable and turned the
      // give-up path into an endless 1 Hz retry loop against a relay that was
      // shedding load. It is reset after a successful rejoin instead.
      if (this.manualReconnectTimer !== null) {
        clearTimeout(this.manualReconnectTimer);
        this.manualReconnectTimer = null;
      }
      logToNative(`[SocketClient] connected via ${this.transportName()}`);
      this.handlers.onConnected();

      // Auto-rejoin only after the initial join has succeeded. The initial
      // join is driven by the caller via joinChannel(); otherwise we'd race
      // with it here and emit join_channel twice on the first connect.
      if (this.channelId && this.hasJoinedOnce) this.attemptRejoin();
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
      // Membership dies with the transport. Anything sealed from here on must
      // be held rather than handed to a socket the relay does not know.
      this.joined = false;
      this.cancelRejoinRetry();
      this.handlers.onDisconnected(reason);
      this.scheduleManualReconnect(reason);
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

  /**
   * Re-join the channel after the transport came back, retrying a refusal.
   *
   * A refused rejoin used to be logged and dropped. That left the socket
   * connected and permanently outside the channel: `onReconnected` never fired,
   * so a held or parked answer was never delivered, and any new send was sealed
   * against a socket the relay would refuse. Both refusals the relay issues are
   * transient, so they are retried; when the budget is spent the handler is
   * told so the session can be retired instead of looking live.
   */
  private attemptRejoin(): void {
    const channelId = this.channelId;
    const socket = this.socket;
    if (!channelId || !socket || !this.hasJoinedOnce) return;
    this.cancelRejoinRetry();
    this.rejoinInFlight = true;
    this.emitJoinChannel(socket, channelId)
      .then(({ bufferedMessages, terminated }) => {
        this.rejoinInFlight = false;
        if (this.socket !== socket || this.channelId !== channelId) return;
        if (terminated) {
          // The dApp explicitly closed the channel while we were away.
          // Don't deliver stale buffered messages or flip back to
          // CONNECTED; surface the termination so the session is dropped.
          this.rejoinAttempts = 0;
          this.handlers.onTerminated?.();
          return;
        }
        this.joined = true;
        this.rejoinAttempts = 0;
        for (const msg of bufferedMessages) {
          this.handlers.onMessage(msg as RelayMessage);
        }
        // A completed rejoin is the first moment the relay has actually
        // taken this channel back, so the retry budget is refilled here.
        this.manualReconnectAttempts = 0;
        this.handlers.onReconnected();
      })
      .catch((err: unknown) => {
        this.rejoinInFlight = false;
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[SocketClient] Auto-rejoin failed:', message);
        logToNative(`[SocketClient] rejoin failed: ${message}`);
        if (this.socket !== socket || this.channelId !== channelId) return;
        this.scheduleRejoinRetry();
      });
  }

  private scheduleRejoinRetry(): void {
    if (this.rejoinTimer !== null) return;
    if (this.rejoinAttempts >= REJOIN_ATTEMPTS) {
      console.warn(
        `[SocketClient] relay refused ${this.rejoinAttempts} rejoins; giving up on the channel`
      );
      this.rejoinAttempts = 0;
      this.handlers.onRejoinAbandoned?.();
      return;
    }
    // Jittered, for the same reason the reconnect budget is: many phones
    // behind one carrier NAT trip the relay's per-IP join limit together.
    const backoff = Math.min(
      REJOIN_BASE_MS * Math.pow(2, this.rejoinAttempts),
      REJOIN_MAX_DELAY_MS
    );
    const delay = Math.round(backoff * (0.5 + Math.random()));
    this.rejoinAttempts += 1;
    this.rejoinTimer = setTimeout(() => {
      this.rejoinTimer = null;
      if (this.socket?.connected) this.attemptRejoin();
    }, delay);
  }

  /**
   * The relay says this socket is not in the channel after all.
   *
   * Drops the local membership claim and starts a fresh rejoin, with a fresh
   * budget, because this is a new episode rather than a continuation of one
   * the retries already gave up on. Callers hold their message meanwhile, and
   * the successful rejoin delivers it.
   */
  private loseMembership(): void {
    this.joined = false;
    if (this.rejoinInFlight || this.rejoinTimer !== null) return;
    this.rejoinAttempts = 0;
    this.attemptRejoin();
  }

  private cancelRejoinRetry(): void {
    if (this.rejoinTimer !== null) {
      clearTimeout(this.rejoinTimer);
      this.rejoinTimer = null;
    }
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
    // A terminated channel routes nothing, so it is not membership.
    this.joined = !result.terminated;
    this.rejoinAttempts = 0;
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
        // Raised before any emit, so nothing left this process. The caller can
        // treat it as unambiguous and keep the message, which a rejected or
        // missing acknowledgement never allows.
        reject(new SocketNotConnectedError());
        return;
      }
      if (!this.joined) {
        // Connected and outside the channel: the relay refuses a frame from a
        // non-member with "Sender not in channel", and the caller reads that
        // rejected acknowledgement as ambiguous and retires the pairing. Refuse
        // here instead, before any emit, so the message is simply held.
        reject(new RelayChannelNotJoinedError());
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
            if (MEMBERSHIP_REFUSALS.has(message)) {
              // The relay's own view says this socket is not in the channel,
              // and it refused before delivering or buffering anything. The
              // client's view was stale, so correct it here and go get the
              // channel back: a successful rejoin is what puts the sealed
              // frame and anything held back on the wire.
              this.loseMembership();
              finish(new RelayChannelNotJoinedError(message));
              return;
            }
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
    this.joined = false;
    this.cancelRejoinRetry();
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
    this.joined = false;
    this.cancelRejoinRetry();
    if (!this.socket?.connected || !channelId) return Promise.resolve(false);
    return this.flushEmit('close_channel', { channelId });
  }

  disconnect(): void {
    this.lifecycleGeneration += 1;
    // An explicit disconnect ends any manual retry: this socket is done.
    if (this.manualReconnectTimer !== null) {
      clearTimeout(this.manualReconnectTimer);
      this.manualReconnectTimer = null;
    }
    this.manualReconnectAttempts = 0;
    this.cancelRejoinRetry();
    this.rejoinAttempts = 0;
    this.rejoinInFlight = false;
    this.joined = false;
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

  /**
   * The relay has this socket in the channel, so a frame handed to it will be
   * routed or buffered rather than refused. This is the reachability question a
   * caller about to spend an AEAD counter actually needs answered.
   */
  isJoined(): boolean {
    return (this.socket?.connected ?? false) && this.joined;
  }

  /**
   * Whether this socket can still come back on its own or through the retry
   * below. False once a server-initiated disconnect has exhausted its retries,
   * which is the signal that anything held for this channel will never be
   * delivered and the session should be retired rather than left waiting.
   */
  willReconnect(): boolean {
    // A connected socket only counts while it is in the channel, has a rejoin
    // on the wire, or has a retry queued. Connected and permanently refused is
    // not coming back, and a message handed to it would never be delivered.
    if (this.socket?.connected) {
      return (
        this.joined ||
        this.rejoinInFlight ||
        this.rejoinTimer !== null ||
        this.joinPromise !== null
      );
    }
    if (this.socket?.active) return true;
    return this.manualReconnectTimer !== null;
  }

  /**
   * Come back after a server-initiated disconnect.
   *
   * socket.io gives up permanently on `io server disconnect`: Socket.ondisconnect
   * destroys the manager, `socket.active` goes false, and nothing retries. The
   * relay uses exactly that for its rate limits, its per-IP and global caps and
   * its backpressure paths, so an ordinary phone behind carrier NAT can hit it.
   * Without a retry the channel sits in RECONNECTING until the page reloads,
   * and anything held for it is never delivered.
   *
   * Bounded, because a relay that keeps refusing is telling the truth. When the
   * retries run out the handler is told, so the session can be retired cleanly
   * instead of becoming a ghost.
   */
  private scheduleManualReconnect(reason: string): void {
    if (reason !== 'io server disconnect') return;
    if (this.manualReconnectTimer !== null) return;

    if (this.manualReconnectAttempts >= MANUAL_RECONNECT_ATTEMPTS) {
      console.warn(
        `[SocketClient] relay refused ${this.manualReconnectAttempts} reconnects; giving up`
      );
      this.manualReconnectAttempts = 0;
      this.handlers.onReconnectAbandoned?.();
      return;
    }

    // Exponential, with jitter: many phones behind one carrier NAT hit the
    // relay's per-IP connect limit together, and a fixed interval would have
    // them all retry in lockstep and keep tripping it.
    const backoff =
      MANUAL_RECONNECT_BASE_MS * Math.pow(2, this.manualReconnectAttempts);
    const delay = Math.round(backoff * (0.5 + Math.random()));
    this.manualReconnectAttempts += 1;
    this.manualReconnectTimer = setTimeout(() => {
      this.manualReconnectTimer = null;
      try {
        this.socket?.connect();
      } catch (err) {
        console.warn('[SocketClient] manual reconnect failed:', err);
        this.scheduleManualReconnect(reason);
      }
    }, delay);
  }
}
