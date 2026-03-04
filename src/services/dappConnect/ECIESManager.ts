/**
 * ECIES encryption/decryption for the wallet side.
 * Mirrors the SDK's ECIESClient.
 */

import { PrivateKey, decrypt, encrypt } from 'eciesjs';
import { Buffer } from 'buffer';

export class ECIESManager {
  private privateKey: PrivateKey;

  constructor(existingPrivateKey?: string) {
    if (existingPrivateKey) {
      this.privateKey = PrivateKey.fromHex(existingPrivateKey);
    } else {
      this.privateKey = new PrivateKey();
    }
  }

  getPublicKey(): string {
    return this.privateKey.publicKey.toHex();
  }

  getPrivateKeyHex(): string {
    return this.privateKey.toHex();
  }

  encrypt(data: string, otherPublicKey: string): string {
    const encrypted = encrypt(otherPublicKey, Buffer.from(data, 'utf8'));
    return Buffer.from(encrypted).toString('base64');
  }

  decrypt(encryptedBase64: string): string {
    const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
    const decrypted = decrypt(this.privateKey.toHex(), encryptedBuffer);
    return Buffer.from(decrypted).toString('utf8');
  }
}
