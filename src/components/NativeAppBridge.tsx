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
} from '@/utils/nativeApp';
import { WalletEncryptionUtil } from '@/utils/crypto/walletEncryption';
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
          StorageUtil.storeEncryptedSeed(blockchain, address, encryptedSeed);
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
            try {
              const blockchain = await StorageUtil.getBlockChain();
              const activeAccount = await StorageUtil.getActiveAccount(blockchain);
              if (!activeAccount) {
                logToNative('No active account found');
                sendPinVerified(false, PIN_VERIFY_ERRORS.NO_ACTIVE_ACCOUNT);
                return;
              }

              const encryptedSeed = await StorageUtil.getEncryptedSeed(blockchain, activeAccount);
              if (!encryptedSeed) {
                logToNative('No encrypted seed found');
                sendPinVerified(false, PIN_VERIFY_ERRORS.NO_ENCRYPTED_SEED);
                return;
              }

              // Try to decrypt with the provided PIN
              WalletEncryptionUtil.decryptSeedWithPin(encryptedSeed, pin);
              logToNative('PIN verified successfully');
              sendPinVerified(true);
            } catch (error) {
              console.error('[Bridge] Error during PIN verification:', error);
              logToNative('PIN verification failed - incorrect PIN');
              sendPinVerified(false, PIN_VERIFY_ERRORS.INCORRECT_PIN);
            }
          })();
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
