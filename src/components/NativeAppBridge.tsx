/**
 * NativeAppBridge Component
 *
 * Listens for messages from the native MyQRLWallet app and dispatches
 * them to appropriate handlers. Mount this at the app root.
 */

import { useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  isInNativeApp,
  subscribeToNativeMessages,
  NativeMessage,
  logToNative,
  setNativeInjectedPin,
  clearNativeInjectedPin,
  confirmWalletCleared,
  notifyWebAppReady,
  dispatchQRResult,
  sendPinVerified,
  sendPinChanged,
} from '@/utils/nativeApp';
import { WalletEncryptionUtil, PinDecryptionError } from '@/utils/crypto/walletEncryption';
import { ROUTES } from '@/router/router';
import StorageUtil from '@/utils/storage/storage';
import { ZOND_PROVIDER } from '@/config';

/** Error messages for PIN verification - forms API contract with native app */
const PIN_VERIFY_ERRORS = {
  INVALID_FORMAT: 'Invalid PIN format',
  NO_ACTIVE_ACCOUNT: 'No active account',
  NO_ENCRYPTED_SEED: 'No encrypted seed found',
  INCORRECT_PIN: 'Incorrect PIN',
} as const;

/** Error messages for PIN change - forms API contract with native app */
const PIN_CHANGE_ERRORS = {
  INVALID_OLD_PIN: 'Invalid old PIN format',
  INVALID_NEW_PIN: 'Invalid new PIN format',
  NO_ENCRYPTED_SEEDS: 'No encrypted seeds found',
  INCORRECT_PIN: 'Incorrect current PIN',
} as const;

/**
 * Restores account state after RESTORE_SEED message.
 * Sets as active if needed (which also adds to account list), then reloads to fetch fresh balance.
 */
async function restoreAccountState(blockchain: string, address: string): Promise<void> {
  try {
    const currentActive = await StorageUtil.getActiveAccount(blockchain);
    if (!currentActive) {
      // setActiveAccount also adds to account list if not present
      await StorageUtil.setActiveAccount(blockchain, address);
      logToNative(`Set ${address} as active account`);
      window.location.reload();
      return;
    }

    // Active account exists - just ensure restored account is in the list
    const accountList = await StorageUtil.getAccountList(blockchain);
    if (!accountList.some(item => item.address.toLowerCase() === address.toLowerCase())) {
      await StorageUtil.setAccountList(blockchain, [...accountList, { address, source: 'seed' }]);
      logToNative(`Added ${address} to account list`);
      window.location.reload();
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Bridge] Error restoring account state:', error);
    logToNative(`Error restoring account state: ${errorMsg}`);
  }
}

/**
 * Handles CHANGE_PIN request from native app.
 * Re-encrypts all seeds with the new PIN.
 */
async function handleChangePinRequest(oldPin: string, newPin: string): Promise<void> {
  try {
    const blockchain = await StorageUtil.getBlockChain();
    const allSeeds = await StorageUtil.getAllEncryptedSeeds(blockchain);

    if (allSeeds.length === 0) {
      logToNative('No encrypted seeds found to re-encrypt');
      sendPinChanged(false, undefined, PIN_CHANGE_ERRORS.NO_ENCRYPTED_SEEDS);
      return;
    }

    // Re-encrypt all seeds with the new PIN
    const updatedSeeds = allSeeds.map(seedData => ({
      ...seedData,
      encryptedSeed: WalletEncryptionUtil.reEncryptSeed(
        seedData.encryptedSeed,
        oldPin,
        newPin
      ),
    }));

    // Save all re-encrypted seeds atomically
    await StorageUtil.updateAllEncryptedSeeds(blockchain, updatedSeeds);

    logToNative(`PIN changed successfully for ${updatedSeeds.length} wallet(s)`);
    sendPinChanged(true, newPin);
  } catch (error) {
    console.error('[Bridge] Error changing PIN:', error);

    // Check if it's a PIN decryption error (incorrect current PIN)
    if (error instanceof PinDecryptionError) {
      logToNative('PIN change failed: incorrect current PIN');
      sendPinChanged(false, undefined, PIN_CHANGE_ERRORS.INCORRECT_PIN);
    } else {
      // Don't expose internal error details to native app
      logToNative(`PIN change failed: ${error instanceof Error ? error.message : String(error)}`);
      sendPinChanged(false, undefined, 'An unexpected error occurred during PIN change.');
    }
  }
}

/**
 * Main bridge component - mount at app root
 */
const NativeAppBridge: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleNativeMessage = useCallback(
    (message: NativeMessage) => {
      const { type, payload } = message;

      switch (type) {
        case 'QR_RESULT': {
          const address = payload?.address;
          if (typeof address !== 'string' || !address) {
            console.warn('[Bridge] QR result missing or invalid address');
            return;
          }

          logToNative(`QR result received: ${address}`);

          // If there's a registered handler, dispatch to it
          if (dispatchQRResult(address)) {
            return;
          }

          // Otherwise, navigate to transfer page with the address
          const searchParams = new URLSearchParams(location.search);
          searchParams.set('to', address);
          navigate(`${ROUTES.TRANSFER}?${searchParams.toString()}`);
          break;
        }

        case 'BIOMETRIC_SUCCESS': {
          const authenticated = payload?.authenticated;
          if (typeof authenticated !== 'boolean') {
            console.warn('[Bridge] BIOMETRIC_SUCCESS missing or invalid authenticated flag');
            return;
          }
          logToNative(`Biometric auth result: ${authenticated}`);
          // Could dispatch to store or trigger app unlock
          break;
        }

        case 'APP_STATE': {
          const state = payload?.state;
          if (state !== 'active' && state !== 'background' && state !== 'inactive') {
            console.warn('[Bridge] APP_STATE missing or invalid state');
            return;
          }
          logToNative(`App state changed: ${state}`);
          // Could be used for:
          // - Clearing sensitive data when backgrounded
          // - Refreshing data when app becomes active
          // - Auto-lock functionality
          break;
        }

        case 'CLIPBOARD_SUCCESS':
          // Could show a toast notification
          console.log('[Bridge] Clipboard success');
          break;

        case 'SHARE_SUCCESS':
          // Could show a toast notification
          console.log('[Bridge] Share success');
          break;

        case 'ERROR':
          console.error('[Bridge] Native error:', payload?.message);
          break;

        // Seed persistence messages
        case 'UNLOCK_WITH_PIN': {
          const pin = payload?.pin;
          if (typeof pin !== 'string' || !pin) {
            console.warn('[Bridge] UNLOCK_WITH_PIN missing or invalid pin');
            return;
          }
          logToNative('PIN received from native app');
          setNativeInjectedPin(pin);
          // The PIN is now available for transaction signing via getNativeInjectedPin()
          break;
        }

        case 'RESTORE_SEED': {
          // Native app sends backup seed if localStorage is empty
          const address = payload?.address;
          const encryptedSeed = payload?.encryptedSeed;
          const blockchain = payload?.blockchain;

          if (
            typeof address !== 'string' || !address ||
            typeof encryptedSeed !== 'string' || !encryptedSeed ||
            typeof blockchain !== 'string' || !blockchain
          ) {
            console.warn('[Bridge] RESTORE_SEED missing or invalid required fields');
            return;
          }

          logToNative(`Restoring seed for ${address}`);

          // Restore encrypted seed and account state
          (async () => {
            try {
              await StorageUtil.storeEncryptedSeed(blockchain, address, encryptedSeed);
              await restoreAccountState(blockchain, address);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              console.error(`[Bridge] Error restoring seed for ${address}:`, error);
              logToNative(`Error restoring seed: ${errorMsg}`);
            }
          })();
          break;
        }

        case 'CLEAR_WALLET': {
          // Native app requests full wallet wipe (from native settings)
          logToNative('Clearing wallet data');
          clearNativeInjectedPin();

          // Clear all wallet data for all blockchains
          const blockchains = Object.keys(ZOND_PROVIDER);
          for (const blockchain of blockchains) {
            StorageUtil.clearActiveAccount(blockchain);
            StorageUtil.clearAllEncryptedSeeds(blockchain);
            StorageUtil.clearAccountList(blockchain);
            StorageUtil.clearTransactionValues(blockchain);
          }
          StorageUtil.clearTokenList();

          // Confirm to native that web cleared its data
          confirmWalletCleared();

          // Reload the app - reload will navigate to appropriate page based on wallet state
          window.location.reload();
          break;
        }

        case 'BIOMETRIC_SETUP_PROMPT':
          // Native is prompting user to enable biometric - nothing to do in web
          logToNative('Biometric setup prompt shown');
          break;

        case 'VERIFY_PIN': {
          // Native asks web to verify PIN can decrypt the stored seed
          const pin = payload?.pin;
          if (typeof pin !== 'string' || !pin) {
            console.warn('[Bridge] VERIFY_PIN missing or invalid pin');
            sendPinVerified(false, PIN_VERIFY_ERRORS.INVALID_FORMAT);
            return;
          }

          logToNative('Verifying PIN...');

          // Use async IIFE with proper error handling to avoid unhandled rejections
          (async () => {
            // Outer try/catch for storage operations
            let blockchain: string;
            let activeAccount: string | null;
            let encryptedSeed: string | null;

            try {
              blockchain = await StorageUtil.getBlockChain();
              activeAccount = await StorageUtil.getActiveAccount(blockchain);
              if (!activeAccount) {
                logToNative('No active account found');
                sendPinVerified(false, PIN_VERIFY_ERRORS.NO_ACTIVE_ACCOUNT);
                return;
              }

              encryptedSeed = await StorageUtil.getEncryptedSeed(blockchain, activeAccount);
              if (!encryptedSeed) {
                logToNative('No encrypted seed found');
                sendPinVerified(false, PIN_VERIFY_ERRORS.NO_ENCRYPTED_SEED);
                return;
              }
            } catch (storageError) {
              console.error('[Bridge] Storage error during PIN verification:', storageError);
              logToNative('PIN verification failed - storage error');
              sendPinVerified(false, 'Storage error');
              return;
            }

            // Inner try/catch specifically for PIN decryption
            try {
              // decryptSeedWithPin throws if PIN is incorrect
              WalletEncryptionUtil.decryptSeedWithPin(encryptedSeed, pin);
              logToNative('PIN verified successfully');
              sendPinVerified(true);
            } catch (decryptError) {
              console.error('[Bridge] Decryption failed - incorrect PIN:', decryptError);
              logToNative('PIN verification failed - incorrect PIN');
              sendPinVerified(false, PIN_VERIFY_ERRORS.INCORRECT_PIN);
            }
          })();
          break;
        }

        case 'CHANGE_PIN': {
          // Native app requests web to re-encrypt all seeds with a new PIN
          const oldPin = payload?.oldPin;
          const newPin = payload?.newPin;

          if (typeof oldPin !== 'string' || !WalletEncryptionUtil.validatePin(oldPin)) {
            console.warn('[Bridge] CHANGE_PIN missing or invalid oldPin');
            sendPinChanged(false, undefined, PIN_CHANGE_ERRORS.INVALID_OLD_PIN);
            return;
          }

          if (typeof newPin !== 'string' || !WalletEncryptionUtil.validatePin(newPin)) {
            console.warn('[Bridge] CHANGE_PIN missing or invalid newPin');
            sendPinChanged(false, undefined, PIN_CHANGE_ERRORS.INVALID_NEW_PIN);
            return;
          }

          logToNative('Changing PIN for all encrypted seeds...');
          handleChangePinRequest(oldPin, newPin);
          break;
        }

        default:
          console.warn('[Bridge] Unknown message type:', type);
      }
    },
    [navigate, location.search]
  );

  useEffect(() => {
    // Only set up listeners if running in native app
    if (!isInNativeApp()) {
      return;
    }

    console.log('[NativeAppBridge] Running in native app, setting up listeners');
    logToNative('Web app bridge initialized');

    const unsubscribe = subscribeToNativeMessages(handleNativeMessage);

    // Notify native app that web app is ready to receive data
    // This enables the handshake mechanism instead of relying on setTimeout
    notifyWebAppReady();
    logToNative('Web app ready signal sent');

    return () => {
      unsubscribe();
    };
  }, [handleNativeMessage]);

  // This component doesn't render anything
  return null;
};

export default NativeAppBridge;
