/**
 * Key Exchange - Wallet side of the 3-step SYN/SYNACK/ACK handshake.
 */

import { ECIESManager } from './ECIESManager';
import { KeyExchangeMessageType } from './types';

const PROTOCOL_VERSION = 1;

interface KeyExchangeOptions {
  /** Used for restoring previously-established sessions. */
  keysAlreadyExchanged?: boolean;
}

export class KeyExchange {
  private ecies: ECIESManager;
  private otherPublicKey: string | null = null;
  private keysExchanged = false;
  private onKeysExchanged?: () => void;

  constructor(
    ecies: ECIESManager,
    otherPublicKey?: string,
    onKeysExchanged?: () => void,
    options: KeyExchangeOptions = {}
  ) {
    this.ecies = ecies;
    this.onKeysExchanged = onKeysExchanged;

    if (otherPublicKey) {
      this.otherPublicKey = otherPublicKey;
      this.keysExchanged = options.keysAlreadyExchanged === true;
    }
  }

  /**
   * Process an incoming key exchange message.
   * Wallet receives SYN, sends SYNACK, then receives ACK.
   * Returns a response to send, or null if handshake is complete.
   */
  onMessage(msg: {
    type: KeyExchangeMessageType;
    pubkey?: string;
    v?: number;
  }): object | null {
    switch (msg.type) {
      case KeyExchangeMessageType.SYN: {
        if (msg.pubkey) {
          if (this.otherPublicKey && this.otherPublicKey !== msg.pubkey) {
            throw new Error('DApp public key mismatch during handshake');
          }
          this.otherPublicKey = msg.pubkey;
        }

        if (!this.otherPublicKey) {
          throw new Error('Missing dApp public key in handshake');
        }

        // Respond with our public key
        return {
          type: KeyExchangeMessageType.SYNACK,
          pubkey: this.ecies.getPublicKey(),
          v: PROTOCOL_VERSION,
        };
      }

      case KeyExchangeMessageType.ACK: {
        // dApp confirms - handshake complete
        this.keysExchanged = true;
        this.onKeysExchanged?.();
        return null;
      }

      default:
        console.warn('[KeyExchange] Unexpected message type:', msg.type);
        return null;
    }
  }

  encryptMessage(data: string): string {
    if (!this.otherPublicKey) {
      throw new Error('Cannot encrypt: no other public key');
    }
    return this.ecies.encrypt(data, this.otherPublicKey);
  }

  decryptMessage(encryptedBase64: string): string {
    return this.ecies.decrypt(encryptedBase64);
  }

  areKeysExchanged(): boolean {
    return this.keysExchanged;
  }

  getOtherPublicKey(): string | null {
    return this.otherPublicKey;
  }
}
