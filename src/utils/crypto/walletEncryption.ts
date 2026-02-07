import CryptoJS from 'crypto-js';
import { Web3BaseWalletAccount } from '@theqrl/web3';
import { isInNativeApp, shareContent } from '@/utils/nativeApp';

export interface WalletData {
  address: string;
  mnemonic: string;
  hexSeed: string;
}

export interface EncryptedWallet {
  address: string;
  encryptedData: string;
  salt: string;
  iv: string;
  version: string;
  timestamp: number;
}

// Extend Web3BaseWalletAccount to include mnemonic and hexSeed
export interface ExtendedWalletAccount extends Web3BaseWalletAccount {
  mnemonic?: string;
  hexSeed?: string;
}

const CURRENT_WALLET_VERSION = 'v1';
const PBKDF2_ITERATIONS = 600000;

/**
 * Custom error class for PIN decryption failures.
 * Allows reliable error type checking without fragile string matching.
 */
export class PinDecryptionError extends Error {
  constructor(message: string = 'Failed to decrypt seed. Invalid PIN.') {
    super(message);
    this.name = 'PinDecryptionError';
  }
}

export class WalletEncryptionUtil {
  static encryptWallet(walletData: WalletData, password: string): EncryptedWallet {
    // Generate random salt and IV
    const salt = CryptoJS.lib.WordArray.random(128/8);
    const iv = CryptoJS.lib.WordArray.random(128/8);

    // Create key using password and salt
    const key = CryptoJS.PBKDF2(password, salt, {
      keySize: 256/32,
      iterations: PBKDF2_ITERATIONS
    });

    // Encrypt sensitive data
    const encrypted = CryptoJS.AES.encrypt(
      JSON.stringify({
        mnemonic: walletData.mnemonic,
        hexSeed: walletData.hexSeed
      }),
      key,
      { iv: iv }
    );

    return {
      address: walletData.address,
      encryptedData: encrypted.toString(),
      salt: salt.toString(),
      iv: iv.toString(),
      version: CURRENT_WALLET_VERSION,
      timestamp: Date.now()
    };
  }

  static decryptWallet(encryptedWallet: EncryptedWallet, password: string): WalletData {
    try {
      const salt = CryptoJS.enc.Hex.parse(encryptedWallet.salt);
      const iv = CryptoJS.enc.Hex.parse(encryptedWallet.iv);

      const key = CryptoJS.PBKDF2(password, salt, {
        keySize: 256/32,
        iterations: PBKDF2_ITERATIONS
      });

      const decrypted = CryptoJS.AES.decrypt(
        encryptedWallet.encryptedData,
        key,
        { iv: iv }
      );

      const decryptedData = JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));

      return {
        address: encryptedWallet.address,
        mnemonic: decryptedData.mnemonic,
        hexSeed: decryptedData.hexSeed
      };
    } catch (_error) {
      throw new Error('Failed to decrypt wallet. Invalid password or corrupted data.');
    }
  }

  static downloadWallet(account: ExtendedWalletAccount | undefined, password?: string) {
    if (!account) {
      throw new Error('Account is required for wallet download');
    }

    if (!account.mnemonic || !account.hexSeed) {
      throw new Error('Account must have mnemonic and hexSeed for wallet download');
    }

    const walletData: WalletData = {
      address: account.address,
      mnemonic: account.mnemonic,
      hexSeed: account.hexSeed
    };

    let fileContent: string;
    let fileName: string;

    if (password) {
      if (!this.validatePassword(password)) {
        throw new Error('Password does not meet security requirements');
      }
      // Encrypted wallet
      const encryptedWallet = this.encryptWallet(walletData, password);
      fileContent = JSON.stringify(encryptedWallet, null, 2);
      fileName = `encrypted-wallet-${walletData.address}.json`;
    } else {
      // Unencrypted wallet (with warning in the file)
      const unencryptedContent = {
        warning: "WARNING: This is an unencrypted wallet file. Never share this file with anyone. Use this file at your own risk.",
        address: walletData.address,
        mnemonic: walletData.mnemonic,
        hexSeed: walletData.hexSeed,
        timestamp: Date.now(),
        version: CURRENT_WALLET_VERSION
      };
      fileContent = JSON.stringify(unencryptedContent, null, 2);
      fileName = `wallet-${walletData.address}.json`;
    }

    // In native app, use share functionality instead of browser download
    if (isInNativeApp()) {
      shareContent({
        title: `QRL Wallet - ${walletData.address.substring(0, 10)}...`,
        text: fileContent,
      });
      return;
    }

    // Browser download
    const blob = new Blob([fileContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  static validatePassword(password: string): boolean {
    // Minimum requirements:
    // - At least 8 characters
    // - Contains at least one uppercase letter
    // - Contains at least one lowercase letter
    // - Contains at least one number
    // - Contains at least one special character
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    return (
      password.length >= minLength &&
      hasUpperCase &&
      hasLowerCase &&
      hasNumbers &&
      hasSpecialChar
    );
  }

  // PIN-based encryption for localStorage
  static encryptSeedWithPin(mnemonic: string, hexSeed: string, pin: string): string {
    // Validate PIN
    if (!this.validatePin(pin)) {
      throw new Error('Invalid PIN format');
    }

    // Generate random salt and IV
    const salt = CryptoJS.lib.WordArray.random(128/8);
    const iv = CryptoJS.lib.WordArray.random(128/8);

    // Use PBKDF2 to derive key from PIN
    const key = CryptoJS.PBKDF2(pin, salt, {
      keySize: 256/32,
      iterations: 600000 // OWASP 2023 recommended minimum for brute force resistance
    });

    const encrypted = CryptoJS.AES.encrypt(
      JSON.stringify({
        mnemonic,
        hexSeed
      }),
      key,
      { iv: iv }
    );

    // Return format that can be stored in localStorage
    return JSON.stringify({
      encryptedData: encrypted.toString(),
      salt: salt.toString(),
      iv: iv.toString(),
      version: 'pin_v3', // v3 uses 600k iterations (v1 used 5k)
      timestamp: Date.now()
    });
  }

  static decryptSeedWithPin(encryptedData: string, pin: string): { mnemonic: string, hexSeed: string } {
    try {
      const parsed = JSON.parse(encryptedData);
      const salt = CryptoJS.enc.Hex.parse(parsed.salt);
      const iv = CryptoJS.enc.Hex.parse(parsed.iv);

      // Support v1 (5k) and v3 (600k) iterations for backward compatibility
      const iterations = parsed.version === 'pin_v3' ? 600000 : 5000;

      const key = CryptoJS.PBKDF2(pin, salt, {
        keySize: 256/32,
        iterations
      });

      const decrypted = CryptoJS.AES.decrypt(
        parsed.encryptedData,
        key,
        { iv: iv }
      );

      return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
    } catch (_error) {
      throw new PinDecryptionError();
    }
  }

  // Simple PIN validation (4-6 digits)
  static validatePin(pin: string): boolean {
    return /^\d{4,6}$/.test(pin);
  }

  // Re-encrypt a seed with a new PIN (for Change PIN feature)
  static reEncryptSeed(encryptedSeed: string, oldPin: string, newPin: string): string {
    // Decrypt with old PIN (throws if oldPin is incorrect)
    const decrypted = this.decryptSeedWithPin(encryptedSeed, oldPin);

    // Re-encrypt with new PIN
    return this.encryptSeedWithPin(decrypted.mnemonic, decrypted.hexSeed, newPin);
  }
}
