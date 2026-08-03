/**
 * Post-quantum handshake — wallet side.
 *
 * The wallet's entry point is receiveQR(cid, pk, cap): the service fetches
 * the dApp's ML-KEM-768 public key from the relay only after verifying the
 * QR's capability-bound fingerprint. We encapsulate, seal HELLO_WALLET, and
 * emit SYNACK over the relay.
 * The dApp answers with ACK carrying a sealed HELLO_DAPP; verifying it
 * completes the handshake.
 *
 * Session-key at-rest model
 * -------------------------
 * exportPersisted() emits the derived AES-256 session key as raw bytes so
 * SessionStore can write it to `localStorage` and survive a page reload.
 * The trust boundary is the browser origin — same as the ECIES private key
 * held by v1 sessions. Anyone with read access to `localStorage` for the
 * wallet origin can decrypt traffic for an active pairing.
 *
 * This is not a regression from v1, but it is a known limitation. The
 * follow-up path (tracked separately) is to wrap the session key with an
 * AES-KW key derived from the user's PIN (already present for seed
 * encryption via WebCrypto AES-256-GCM), so a pilfered localStorage dump is
 * useless without the PIN. Out of scope for this PR.
 *
 * Mitigations in place today: 7-day session TTL, explicit disconnect
 * clears the record, and `qrlconnect:sessions` records without persistence
 * storage `version: 4` are dropped on load. v4 checkpoints AEAD counters after
 * every seal/open and identifies capability-bound PQP3 session material.
 */

import {
  DIR_DAPP_TX,
  DIR_WALLET_TX,
  CAP_LEN,
  CID_LEN,
  ML_KEM_768_PK_LEN,
  constantTimeEquals,
  deriveAeadKey,
  exportRawAeadKey,
  fromBase64,
  importRawAeadKey,
  kemEncaps,
  open,
  seal,
  toBase64,
  transcriptHash,
  zeroize,
} from './PQCrypto';
import { KeyExchangeMessageType } from './types';

export const PROTOCOL_VERSION = 3;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const HELLO_WALLET = textEncoder.encode('hello/wallet/v1');
const HELLO_DAPP = textEncoder.encode('hello/dapp/v1');
const ACK_CIPHERTEXT_LEN = HELLO_DAPP.length + 16;
const ACK_CIPHERTEXT_B64_LEN = Math.ceil(ACK_CIPHERTEXT_LEN / 3) * 4;

export interface Session {
  cid: Uint8Array;
  key: CryptoKey;
  htx: Uint8Array;
  sendDir: Uint8Array;
  recvDir: Uint8Array;
  sendSeq: number;
  recvSeq: number;
}

export interface PersistedSession {
  protocolVersion: 3;
  cid: string;
  kAeadRaw: string;
  htx: string;
  sendDir: string;
  recvDir: string;
  sendSeq: number;
  recvSeq: number;
}

interface DecodedPersistedSession {
  cid: Uint8Array;
  kAeadRaw: Uint8Array;
  htx: Uint8Array;
  sendDir: Uint8Array;
  recvDir: Uint8Array;
}

function decodeExactBase64(value: unknown, byteLength: number): Uint8Array {
  const encodedLength = Math.ceil(byteLength / 3) * 4;
  if (typeof value !== 'string' || value.length !== encodedLength) {
    throw new Error('KeyExchange: malformed persisted base64');
  }
  let decoded: Uint8Array;
  try {
    decoded = fromBase64(value);
  } catch {
    throw new Error('KeyExchange: malformed persisted base64');
  }
  if (decoded.length !== byteLength || toBase64(decoded) !== value) {
    zeroize(decoded);
    throw new Error('KeyExchange: malformed persisted base64');
  }
  return decoded;
}

function decodePersistedSession(p: PersistedSession): DecodedPersistedSession {
  if (
    !p ||
    p.protocolVersion !== PROTOCOL_VERSION ||
    !Number.isSafeInteger(p.sendSeq) ||
    p.sendSeq < 0 ||
    p.sendSeq >= Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(p.recvSeq) ||
    p.recvSeq < 0 ||
    p.recvSeq >= Number.MAX_SAFE_INTEGER
  ) {
    throw new Error('KeyExchange: invalid persisted session');
  }

  const decoded: Partial<DecodedPersistedSession> = {};
  try {
    decoded.cid = decodeExactBase64(p.cid, CID_LEN);
    decoded.kAeadRaw = decodeExactBase64(p.kAeadRaw, 32);
    decoded.htx = decodeExactBase64(p.htx, 32);
    decoded.sendDir = decodeExactBase64(p.sendDir, 4);
    decoded.recvDir = decodeExactBase64(p.recvDir, 4);
    if (
      !constantTimeEquals(decoded.sendDir, DIR_WALLET_TX) ||
      !constantTimeEquals(decoded.recvDir, DIR_DAPP_TX)
    ) {
      throw new Error('KeyExchange: invalid persisted directions');
    }
    return decoded as DecodedPersistedSession;
  } catch (error) {
    for (const value of Object.values(decoded)) {
      if (value instanceof Uint8Array) zeroize(value);
    }
    throw error;
  }
}

export function isPersistedSessionEncodingValid(p: PersistedSession): boolean {
  let decoded: DecodedPersistedSession | null = null;
  try {
    decoded = decodePersistedSession(p);
    return true;
  } catch {
    return false;
  } finally {
    if (decoded) {
      zeroize(decoded.cid);
      zeroize(decoded.kAeadRaw);
      zeroize(decoded.htx);
      zeroize(decoded.sendDir);
      zeroize(decoded.recvDir);
    }
  }
}

export interface SynAckMessage {
  type: KeyExchangeMessageType.SYNACK;
  ct: string;
  c0: string;
  v: number;
}

export interface AckMessage {
  type: KeyExchangeMessageType.ACK;
  c1: string;
  v: number;
}

interface KeyExchangeOptions {
  /** Fires when the handshake reaches CONNECTED state. */
  onKeysExchanged?: () => void | Promise<void>;
}

export class KeyExchange {
  private session: Session | null = null;
  private awaitingAck = false;
  private keysExchanged = false;
  private onKeysExchanged?: () => void | Promise<void>;
  private stateGeneration = 0;

  constructor(restored?: Session, options: KeyExchangeOptions = {}) {
    this.onKeysExchanged = options.onKeysExchanged;
    if (restored) {
      this.session = restored;
      this.keysExchanged = true;
    }
  }

  /**
   * Run Encaps on the dApp's ML-KEM pk and prepare the SYNACK wire message.
   * After this call, the wallet is waiting for a valid ACK.
   */
  async receiveQR(
    cid: Uint8Array,
    pk: Uint8Array,
    cap: Uint8Array
  ): Promise<SynAckMessage> {
    if (cid.length !== CID_LEN) {
      throw new Error(`KeyExchange: cid must be ${CID_LEN} bytes`);
    }
    if (pk.length !== ML_KEM_768_PK_LEN) {
      throw new Error(`KeyExchange: public key must be ${ML_KEM_768_PK_LEN} bytes`);
    }
    if (cap.length !== CAP_LEN) {
      throw new Error(`KeyExchange: capability must be ${CAP_LEN} bytes`);
    }
    if (this.keysExchanged) {
      throw new Error('KeyExchange: session is already established');
    }

    this.retireProvisional();
    const generation = this.stateGeneration;

    // Own a single stable capability copy across the asynchronous KDF calls.
    // The caller remains responsible for wiping its parsed QR copy.
    const stableCap = cap.slice();
    const stableCid = cid.slice();
    let ss: Uint8Array | null = null;
    let htx: Uint8Array | null = null;
    let committed = false;
    try {
      const encapsulated = kemEncaps(pk);
      const { ct } = encapsulated;
      ss = encapsulated.ss;
      htx = await transcriptHash(stableCid, pk, ct, stableCap);
      this.assertGeneration(generation);
      const key = await deriveAeadKey(ss, htx, stableCap);
      this.assertGeneration(generation);
      const c0 = await seal(key, DIR_WALLET_TX, 0, htx, HELLO_WALLET);
      this.assertGeneration(generation);

      this.session = {
        cid: stableCid,
        key,
        htx,
        sendDir: DIR_WALLET_TX,
        recvDir: DIR_DAPP_TX,
        sendSeq: 1,
        recvSeq: 1,
      };
      this.awaitingAck = true;
      committed = true;

      return {
        type: KeyExchangeMessageType.SYNACK,
        ct: toBase64(ct),
        c0: toBase64(c0),
        v: PROTOCOL_VERSION,
      };
    } catch (error) {
      this.retireProvisional(generation);
      throw error;
    } finally {
      if (ss) zeroize(ss);
      if (htx && !committed) zeroize(htx);
      zeroize(stableCap);
    }
  }

  /** Verify the dApp's ACK and finalize the session. */
  async onAck(msg: AckMessage): Promise<void> {
    if (!this.awaitingAck) return;
    if (!this.session) {
      throw new Error('KeyExchange: onAck without a session');
    }
    const generation = this.stateGeneration;
    const session = this.session;
    let hello: Uint8Array | null = null;
    try {
      if (
        !msg ||
        msg.type !== KeyExchangeMessageType.ACK ||
        msg.v !== PROTOCOL_VERSION ||
        typeof msg.c1 !== 'string' ||
        msg.c1.length !== ACK_CIPHERTEXT_B64_LEN
      ) {
        throw new Error(`KeyExchange: ACK must use protocol v${PROTOCOL_VERSION}`);
      }
      this.awaitingAck = false;

      const c1 = fromBase64(msg.c1);
      if (c1.length !== ACK_CIPHERTEXT_LEN || toBase64(c1) !== msg.c1) {
        throw new Error('KeyExchange: ACK ciphertext is malformed');
      }
      try {
        hello = await open(session.key, DIR_DAPP_TX, 0, session.htx, c1);
      } catch {
        throw new Error('KeyExchange: dApp hello AEAD tag failed');
      }
      this.assertGeneration(generation, session);
      if (!constantTimeEquals(hello, HELLO_DAPP)) {
        throw new Error('KeyExchange: dApp hello mismatch');
      }

      this.keysExchanged = true;
    } catch (error) {
      this.retireProvisional(generation, session);
      throw error;
    } finally {
      if (hello) zeroize(hello);
    }

    await this.onKeysExchanged?.();
  }

  private assertGeneration(generation: number, session?: Session): void {
    if (
      this.stateGeneration !== generation ||
      (session !== undefined && this.session !== session)
    ) {
      throw new Error('KeyExchange: handshake generation changed');
    }
  }

  private retireProvisional(expectedGeneration?: number, expectedSession?: Session): void {
    if (
      (expectedGeneration !== undefined && this.stateGeneration !== expectedGeneration) ||
      (expectedSession !== undefined && this.session !== expectedSession) ||
      this.keysExchanged
    ) {
      return;
    }
    if (this.session) zeroize(this.session.htx);
    this.session = null;
    this.awaitingAck = false;
    this.keysExchanged = false;
    this.stateGeneration++;
  }

  async encryptMessage(data: string): Promise<string> {
    if (!this.session) {
      throw new Error('KeyExchange: session not established');
    }
    // Reserve the nonce sequence synchronously, before seal() reaches its
    // first await. Concurrent callers must never observe the same sendSeq:
    // doing so would reuse an AES-GCM nonce under the same key. The service's
    // outbound queue additionally preserves ciphertext delivery order.
    if (this.session.sendSeq >= Number.MAX_SAFE_INTEGER) {
      throw new Error('KeyExchange: send counter exhausted');
    }
    const seq = this.session.sendSeq++;
    const pt = textEncoder.encode(data);
    try {
      const ct = await seal(
        this.session.key,
        this.session.sendDir,
        seq,
        this.session.htx,
        pt
      );
      return toBase64(ct);
    } finally {
      zeroize(pt);
    }
  }

  async decryptMessage(b64: string): Promise<string> {
    if (!this.session) {
      throw new Error('KeyExchange: session not established');
    }
    if (this.session.recvSeq >= Number.MAX_SAFE_INTEGER) {
      throw new Error('KeyExchange: receive counter exhausted');
    }
    const ct = fromBase64(b64);
    const pt = await open(
      this.session.key,
      this.session.recvDir,
      this.session.recvSeq,
      this.session.htx,
      ct
    );
    this.session.recvSeq++;
    try {
      return textDecoder.decode(pt);
    } finally {
      zeroize(pt);
    }
  }

  areKeysExchanged(): boolean {
    return this.keysExchanged;
  }

  getSession(): Session | null {
    return this.session;
  }

  async exportPersisted(): Promise<PersistedSession | null> {
    const session = this.session;
    if (!session || !this.keysExchanged) return null;
    const generation = this.stateGeneration;
    const cid = session.cid.slice();
    const htx = session.htx.slice();
    const sendDir = session.sendDir.slice();
    const recvDir = session.recvDir.slice();
    const sendSeq = session.sendSeq;
    const recvSeq = session.recvSeq;
    let rawKey: Uint8Array | null = null;
    try {
      rawKey = await exportRawAeadKey(session.key);
      this.assertGeneration(generation, session);
      return {
        protocolVersion: PROTOCOL_VERSION,
        cid: toBase64(cid),
        kAeadRaw: toBase64(rawKey),
        htx: toBase64(htx),
        sendDir: toBase64(sendDir),
        recvDir: toBase64(recvDir),
        sendSeq,
        recvSeq,
      };
    } finally {
      if (rawKey) zeroize(rawKey);
      zeroize(cid);
      zeroize(htx);
      zeroize(sendDir);
      zeroize(recvDir);
    }
  }

  static async sessionFromPersisted(p: PersistedSession): Promise<Session> {
    const decoded = decodePersistedSession(p);
    let retained = false;
    try {
      const key = await importRawAeadKey(decoded.kAeadRaw);
      retained = true;
      return {
        cid: decoded.cid,
        key,
        htx: decoded.htx,
        sendDir: decoded.sendDir,
        recvDir: decoded.recvDir,
        sendSeq: p.sendSeq,
        recvSeq: p.recvSeq,
      };
    } finally {
      zeroize(decoded.kAeadRaw);
      if (!retained) {
        zeroize(decoded.cid);
        zeroize(decoded.htx);
        zeroize(decoded.sendDir);
        zeroize(decoded.recvDir);
      }
    }
  }
}
