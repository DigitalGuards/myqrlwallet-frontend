/**
 * BridgeCrypto - ML-KEM-1024 Key Encapsulation for Secure Bridge Communication (Web)
 *
 * Implements post-quantum secure key exchange using ML-KEM-1024 (FIPS 203)
 * and AES-256-GCM for encrypting sensitive bridge messages.
 *
 * Uses @noble/post-quantum for ML-KEM and Web Crypto API for AES-GCM.
 * Compatible with native app's BridgeCrypto.ts implementation.
 *
 * Security model:
 * - Post-quantum secure key exchange (NIST Category 5, ~AES-256 equivalent)
 * - Web acts as DECAPSULATOR: generates keypair, decapsulates to get shared secret
 * - Native acts as ENCAPSULATOR: receives web's public key, generates shared secret
 * - AES-256-GCM key derived from shared secret using HKDF
 * - Random IV per message, prepended to ciphertext
 *
 * Protocol:
 * 1. Web generates ML-KEM keypair, sends encapsulation key to native
 * 2. Native encapsulates: (ciphertext, sharedSecret) = encapsulate(webPublicKey)
 * 3. Native sends ciphertext back to web
 * 4. Web decapsulates: sharedSecret = decapsulate(ciphertext, secretKey)
 * 5. Both derive AES key from shared secret
 */

import { ml_kem1024 } from '@noble/post-quantum/ml-kem';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

// Constants
const AES_KEY_LENGTH = 256; // bits
const IV_LENGTH = 12; // bytes (96 bits for GCM)

// HKDF parameters - MUST match native BridgeCrypto.ts
const HKDF_INFO = 'BridgeCrypto-ML-KEM-1024-AES-GCM-Key';
const HKDF_SALT = 'MyQRLWallet-Bridge-v2';

/**
 * Encrypted message envelope - matches native EncryptedEnvelope
 */
export interface EncryptedEnvelope {
  /** Base64-encoded ciphertext with IV prepended */
  encrypted: string;
  /** Indicates message is encrypted */
  isEncrypted: true;
}

/**
 * ML-KEM-1024 keypair
 */
interface MlKemKeyPair {
  publicKey: Uint8Array; // 1568 bytes (encapsulation key)
  secretKey: Uint8Array; // 3168 bytes (decapsulation key)
}

/**
 * Key exchange state for decapsulator (web)
 */
interface DecapsulatorState {
  keyPair: MlKemKeyPair;
  sharedSecret: Uint8Array | null;
  aesKey: CryptoKey | null;
  isReady: boolean;
  encryptionEnabled: boolean;
}

/**
 * BridgeCrypto service singleton
 * Web acts as DECAPSULATOR in ML-KEM key exchange
 */
class BridgeCryptoService {
  private state: DecapsulatorState | null = null;
  private onReadyCallbacks: Array<() => void> = [];

  /**
   * Check if encryption is ready (key exchange complete)
   */
  isReady(): boolean {
    return this.state?.isReady ?? false;
  }

  /**
   * Check if encryption should be used for messages
   * Returns true only if key exchange completed successfully and encryption is enabled
   */
  shouldEncrypt(): boolean {
    return this.state?.encryptionEnabled === true && this.state?.isReady === true;
  }

  /**
   * Get the public key (encapsulation key) for key exchange
   * Generates new keypair if not already initialized
   *
   * @returns Base64-encoded ML-KEM-1024 public key (1568 bytes)
   */
  async getPublicKey(): Promise<string> {
    if (!this.state) {
      await this.generateKeyPair();
    }
    return this.uint8ArrayToBase64(this.state!.keyPair.publicKey);
  }

  /**
   * Generate a new ML-KEM-1024 keypair
   */
  async generateKeyPair(): Promise<void> {
    const keyPair = ml_kem1024.keygen();

    this.state = {
      keyPair,
      sharedSecret: null,
      aesKey: null,
      isReady: false,
      encryptionEnabled: false,
    };

    console.debug('[BridgeCrypto] Generated new ML-KEM-1024 keypair');
  }

  /**
   * Complete key exchange by decapsulating native's ciphertext
   *
   * @param ciphertextBase64 - Ciphertext from native's encapsulation in base64
   * @returns true if decapsulation succeeded, false otherwise
   */
  async completeKeyExchange(ciphertextBase64: string): Promise<boolean> {
    if (!this.state) {
      console.error('[BridgeCrypto] Cannot complete key exchange: no keypair generated');
      return false;
    }

    try {
      const ciphertext = this.base64ToUint8Array(ciphertextBase64);

      // Validate ciphertext size (ML-KEM-1024 ciphertext is 1568 bytes)
      if (ciphertext.length !== 1568) {
        console.error(`[BridgeCrypto] Invalid ciphertext size: ${ciphertext.length} (expected 1568)`);
        return false;
      }

      // Decapsulate: extract shared secret using our secret key
      const sharedSecret = ml_kem1024.decapsulate(ciphertext, this.state.keyPair.secretKey);

      // Derive AES key using HKDF (via Web Crypto API)
      const aesKey = await this.deriveAesKey(sharedSecret);

      this.state.sharedSecret = new Uint8Array(sharedSecret);
      this.state.aesKey = aesKey;
      this.state.isReady = true;
      this.state.encryptionEnabled = true;

      console.debug('[BridgeCrypto] ML-KEM-1024 key decapsulation completed successfully');

      // Notify any waiting callbacks
      this.onReadyCallbacks.forEach(cb => cb());
      this.onReadyCallbacks = [];

      return true;
    } catch (error) {
      console.error('[BridgeCrypto] Key decapsulation failed:', error);
      return false;
    }
  }

  /**
   * Derive AES-256-GCM key from shared secret using HKDF
   */
  private async deriveAesKey(sharedSecret: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();

    // Use @noble/hashes HKDF to match native implementation exactly
    const derivedKeyBytes = hkdf(
      sha256,
      sharedSecret,
      encoder.encode(HKDF_SALT),
      encoder.encode(HKDF_INFO),
      32 // 256 bits
    );

    // Import the derived bytes as a CryptoKey for Web Crypto API
    // Cast to satisfy TypeScript's strict ArrayBuffer typing
    return crypto.subtle.importKey(
      'raw',
      derivedKeyBytes.buffer.slice(
        derivedKeyBytes.byteOffset,
        derivedKeyBytes.byteOffset + derivedKeyBytes.byteLength
      ) as ArrayBuffer,
      { name: 'AES-GCM', length: AES_KEY_LENGTH },
      false, // non-extractable for security
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt a message using AES-256-GCM
   *
   * @param plaintext - String to encrypt
   * @returns Encrypted envelope or null if encryption not ready
   */
  async encrypt(plaintext: string): Promise<EncryptedEnvelope | null> {
    if (!this.state?.isReady || !this.state.aesKey) {
      console.warn('[BridgeCrypto] Cannot encrypt: key exchange not complete');
      return null;
    }

    try {
      // Generate random IV
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

      // Convert plaintext to bytes
      const plaintextBytes = new TextEncoder().encode(plaintext);

      // Encrypt using AES-GCM
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        this.state.aesKey,
        plaintextBytes
      );

      // Prepend IV to ciphertext
      const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(ciphertext), IV_LENGTH);

      return {
        encrypted: this.uint8ArrayToBase64(combined),
        isEncrypted: true,
      };
    } catch (error) {
      console.error('[BridgeCrypto] Encryption failed:', error);
      return null;
    }
  }

  /**
   * Decrypt a message using AES-256-GCM
   *
   * @param envelope - Encrypted envelope
   * @returns Decrypted string or null if decryption fails
   */
  async decrypt(envelope: EncryptedEnvelope): Promise<string | null> {
    if (!this.state?.isReady || !this.state.aesKey) {
      console.warn('[BridgeCrypto] Cannot decrypt: key exchange not complete');
      return null;
    }

    try {
      // Decode the combined IV + ciphertext
      const combined = this.base64ToUint8Array(envelope.encrypted);

      // Extract IV and ciphertext
      const iv = combined.slice(0, IV_LENGTH);
      const ciphertext = combined.slice(IV_LENGTH);

      // Decrypt using AES-GCM
      const plaintextBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.state.aesKey,
        ciphertext
      );

      return new TextDecoder().decode(plaintextBuffer);
    } catch (error) {
      console.error('[BridgeCrypto] Decryption failed:', error);
      return null;
    }
  }

  /**
   * Reset the crypto state (call on session end or page reload)
   */
  reset(): void {
    // Clear sensitive data
    if (this.state) {
      if (this.state.sharedSecret) this.state.sharedSecret.fill(0);
      // Secret key should be cleared too
      this.state.keyPair.secretKey.fill(0);
    }
    this.state = null;
    this.onReadyCallbacks = [];
    console.debug('[BridgeCrypto] Crypto state reset');
  }

  /**
   * Wait for key exchange to complete
   * @param timeoutMs - Maximum time to wait (default 10 seconds)
   */
  waitForReady(timeoutMs: number = 10000): Promise<void> {
    if (this.state?.isReady) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.onReadyCallbacks.indexOf(callback);
        if (index !== -1) this.onReadyCallbacks.splice(index, 1);
        reject(new Error('Key exchange timeout'));
      }, timeoutMs);

      const callback = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.onReadyCallbacks.push(callback);
    });
  }

  // ============================================================
  // Private helpers
  // ============================================================

  /**
   * Convert Uint8Array to base64 string
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 string to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

// Export singleton instance
const BridgeCrypto = new BridgeCryptoService();
export default BridgeCrypto;

/**
 * Type guard to check if a message is an encrypted envelope
 */
export function isEncryptedEnvelope(message: unknown): message is EncryptedEnvelope {
  return (
    typeof message === 'object' &&
    message !== null &&
    'isEncrypted' in message &&
    (message as EncryptedEnvelope).isEncrypted === true &&
    'encrypted' in message &&
    typeof (message as EncryptedEnvelope).encrypted === 'string'
  );
}
