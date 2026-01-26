/**
 * BridgeCrypto - ECDH Key Agreement for Secure Bridge Communication (Web)
 *
 * Implements ephemeral ECDH key exchange using P-256 (secp256r1) curve
 * and AES-256-GCM for encrypting sensitive bridge messages.
 *
 * Uses the Web Crypto API (SubtleCrypto) for all cryptographic operations.
 * This is compatible with the native app's BridgeCrypto.ts implementation.
 *
 * Security model:
 * - Each session generates new ephemeral keypairs
 * - Shared secret derived via ECDH
 * - AES-256-GCM key derived from shared secret using HKDF
 * - Random IV per message, prepended to ciphertext
 */

// Constants - MUST match native BridgeCrypto.ts
const AES_KEY_LENGTH = 256; // bits
const IV_LENGTH = 12; // bytes (96 bits for GCM)

// HKDF parameters - MUST match native
const HKDF_INFO = 'BridgeCrypto-AES-GCM-Key';
const HKDF_SALT = 'MyQRLWallet-Bridge-v1';

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
 * Key exchange state
 */
interface KeyExchangeState {
  keyPair: CryptoKeyPair;
  publicKeyBytes: Uint8Array; // Raw uncompressed format for exchange
  sharedSecret: ArrayBuffer | null;
  aesKey: CryptoKey | null;
  isReady: boolean;
  encryptionEnabled: boolean;
}

/**
 * BridgeCrypto service singleton
 * Manages ECDH key exchange and message encryption/decryption
 */
class BridgeCryptoService {
  private state: KeyExchangeState | null = null;
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
   * Get the public key for key exchange (base64 encoded)
   * Generates new keypair if not already initialized
   */
  async getPublicKey(): Promise<string> {
    if (!this.state) {
      await this.generateKeyPair();
    }
    return this.uint8ArrayToBase64(this.state!.publicKeyBytes);
  }

  /**
   * Generate a new ephemeral ECDH keypair using Web Crypto API
   */
  async generateKeyPair(): Promise<void> {
    // Generate P-256 key pair
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true, // extractable - needed to export public key
      ['deriveBits']
    );

    // Export public key in raw format (uncompressed: 0x04 + 32 bytes X + 32 bytes Y)
    const publicKeyBuffer = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const publicKeyBytes = new Uint8Array(publicKeyBuffer);

    this.state = {
      keyPair,
      publicKeyBytes,
      sharedSecret: null,
      aesKey: null,
      isReady: false,
      encryptionEnabled: false,
    };

    console.debug('[BridgeCrypto] Generated new ECDH keypair');
  }

  /**
   * Complete key exchange with peer's public key
   * Derives shared secret and AES key
   *
   * @param peerPublicKeyBase64 - Peer's public key in base64 (uncompressed P-256)
   */
  async completeKeyExchange(peerPublicKeyBase64: string): Promise<boolean> {
    if (!this.state) {
      console.error('[BridgeCrypto] Cannot complete key exchange: no keypair generated');
      return false;
    }

    try {
      const peerPublicKeyBytes = this.base64ToUint8Array(peerPublicKeyBase64);

      // Import peer's public key
      // Cast to ArrayBuffer to satisfy TypeScript 5.x strict typing
      const peerPublicKey = await crypto.subtle.importKey(
        'raw',
        peerPublicKeyBytes.buffer as ArrayBuffer,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
      );

      // Derive shared secret via ECDH (256 bits = 32 bytes)
      const sharedSecret = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: peerPublicKey },
        this.state.keyPair.privateKey,
        256
      );

      // Derive AES key using HKDF
      const aesKey = await this.deriveAesKey(sharedSecret);

      this.state.sharedSecret = sharedSecret;
      this.state.aesKey = aesKey;
      this.state.isReady = true;
      this.state.encryptionEnabled = true;

      console.debug('[BridgeCrypto] Key exchange completed successfully');

      // Notify any waiting callbacks
      this.onReadyCallbacks.forEach(cb => cb());
      this.onReadyCallbacks = [];

      return true;
    } catch (error) {
      console.error('[BridgeCrypto] Key exchange failed:', error);
      return false;
    }
  }

  /**
   * Derive AES-256-GCM key from shared secret using HKDF
   */
  private async deriveAesKey(sharedSecret: ArrayBuffer): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const salt = encoder.encode(HKDF_SALT);
    const info = encoder.encode(HKDF_INFO);

    // Import shared secret as HKDF key
    const hkdfKey = await crypto.subtle.importKey(
      'raw',
      sharedSecret,
      'HKDF',
      false,
      ['deriveKey']
    );

    // Derive AES-GCM key
    return crypto.subtle.deriveKey(
      { name: 'HKDF', salt, info, hash: 'SHA-256' },
      hkdfKey,
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
    // Clear state (CryptoKey objects are automatically garbage collected)
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
