/**
 * Post-quantum handshake — wallet side.
 *
 * The wallet's entry point is receiveQR(cid, pk): the QR scan hands us
 * the dApp's ML-KEM-768 public key directly, out-of-band through the user's
 * camera. We encapsulate, seal HELLO_WALLET, and emit SYNACK over the relay.
 * The dApp answers with ACK carrying a sealed HELLO_DAPP; verifying it
 * completes the handshake.
 */

import {
  DIR_DAPP_TX,
  DIR_WALLET_TX,
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

const PROTOCOL_VERSION = 2;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const HELLO_WALLET = textEncoder.encode('hello/wallet/v1');
const HELLO_DAPP = textEncoder.encode('hello/dapp/v1');

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
  cid: string;
  kAeadRaw: string;
  htx: string;
  sendDir: string;
  recvDir: string;
  sendSeq: number;
  recvSeq: number;
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
  onKeysExchanged?: () => void;
}

export class KeyExchange {
  private session: Session | null = null;
  private awaitingAck = false;
  private keysExchanged = false;
  private onKeysExchanged?: () => void;

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
  async receiveQR(cid: Uint8Array, pk: Uint8Array): Promise<SynAckMessage> {
    const { ct, ss } = kemEncaps(pk);
    const htx = await transcriptHash(cid, pk, ct);
    const key = await deriveAeadKey(ss, htx);
    const c0 = await seal(key, DIR_WALLET_TX, 0, htx, HELLO_WALLET);
    zeroize(ss);

    this.session = {
      cid,
      key,
      htx,
      sendDir: DIR_WALLET_TX,
      recvDir: DIR_DAPP_TX,
      sendSeq: 1,
      recvSeq: 1,
    };
    this.awaitingAck = true;

    return {
      type: KeyExchangeMessageType.SYNACK,
      ct: toBase64(ct),
      c0: toBase64(c0),
      v: PROTOCOL_VERSION,
    };
  }

  /** Verify the dApp's ACK and finalize the session. */
  async onAck(msg: AckMessage): Promise<void> {
    if (!this.awaitingAck) return;
    if (!this.session) {
      throw new Error('KeyExchange: onAck without a session');
    }
    this.awaitingAck = false;

    const c1 = fromBase64(msg.c1);
    let hello: Uint8Array;
    try {
      hello = await open(this.session.key, DIR_DAPP_TX, 0, this.session.htx, c1);
    } catch {
      throw new Error('KeyExchange: dApp hello AEAD tag failed');
    }
    if (!constantTimeEquals(hello, HELLO_DAPP)) {
      throw new Error('KeyExchange: dApp hello mismatch');
    }

    this.keysExchanged = true;
    this.onKeysExchanged?.();
  }

  async encryptMessage(data: string): Promise<string> {
    if (!this.session) {
      throw new Error('KeyExchange: session not established');
    }
    const pt = textEncoder.encode(data);
    const ct = await seal(
      this.session.key,
      this.session.sendDir,
      this.session.sendSeq,
      this.session.htx,
      pt
    );
    this.session.sendSeq++;
    return toBase64(ct);
  }

  async decryptMessage(b64: string): Promise<string> {
    if (!this.session) {
      throw new Error('KeyExchange: session not established');
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
    return textDecoder.decode(pt);
  }

  areKeysExchanged(): boolean {
    return this.keysExchanged;
  }

  getSession(): Session | null {
    return this.session;
  }

  async exportPersisted(): Promise<PersistedSession | null> {
    if (!this.session) return null;
    return {
      cid: toBase64(this.session.cid),
      kAeadRaw: toBase64(await exportRawAeadKey(this.session.key)),
      htx: toBase64(this.session.htx),
      sendDir: toBase64(this.session.sendDir),
      recvDir: toBase64(this.session.recvDir),
      sendSeq: this.session.sendSeq,
      recvSeq: this.session.recvSeq,
    };
  }

  static async sessionFromPersisted(p: PersistedSession): Promise<Session> {
    const key = await importRawAeadKey(fromBase64(p.kAeadRaw));
    return {
      cid: fromBase64(p.cid),
      key,
      htx: fromBase64(p.htx),
      sendDir: fromBase64(p.sendDir),
      recvDir: fromBase64(p.recvDir),
      sendSeq: p.sendSeq,
      recvSeq: p.recvSeq,
    };
  }
}
