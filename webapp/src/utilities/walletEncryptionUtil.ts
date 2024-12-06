import CryptoJS from 'crypto-js';
import { Web3BaseWalletAccount } from '@theqrl/web3';

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
const PBKDF2_ITERATIONS = 10000;

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
    } catch (error) {
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
}
