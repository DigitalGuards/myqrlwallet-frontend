/**
 * Native App Bridge Utilities
 *
 * Provides detection and communication with the MyQRLWallet native app
 * when the web app is running inside the native WebView.
 */

/**
 * Message types that can be sent to the native app
 */
export type WebToNativeMessageType =
  | 'SCAN_QR'
  | 'COPY_TO_CLIPBOARD'
  | 'SHARE'
  | 'TX_CONFIRMED'
  | 'LOG'
  | 'OPEN_URL'              // Open external URL in device browser
  | 'HAPTIC'                // Trigger haptic feedback
  // Seed persistence messages
  | 'SEED_STORED'           // Web stored encrypted seed, native should backup
  | 'REQUEST_BIOMETRIC_UNLOCK'  // Web asks native to unlock with biometric
  | 'WALLET_CLEARED'        // Web confirmed it cleared localStorage
  | 'WEB_APP_READY'         // Web app is fully initialized and ready to receive data
  // Navigation messages
  | 'OPEN_NATIVE_SETTINGS'; // Request native app to open its settings screen

/**
 * Message types that can be received from the native app
 */
export type NativeToWebMessageType =
  | 'QR_RESULT'
  | 'BIOMETRIC_SUCCESS'
  | 'APP_STATE'
  | 'CLIPBOARD_SUCCESS'
  | 'SHARE_SUCCESS'
  | 'ERROR'
  // Seed persistence messages
  | 'UNLOCK_WITH_PIN'       // Native sends PIN after biometric success
  | 'RESTORE_SEED'          // Native sends backup seed if localStorage empty
  | 'CLEAR_WALLET'          // Native requests web to clear wallet
  | 'BIOMETRIC_SETUP_PROMPT'; // Native prompts user to enable biometric

export interface NativeMessage {
  type: NativeToWebMessageType;
  payload?: Record<string, unknown>;
}

// Debug: log user agent once
let userAgentLogged = false;

/**
 * Check if the web app is running inside the native MyQRLWallet app
 */
export const isInNativeApp = (): boolean => {
  if (typeof navigator === 'undefined') return false;

  // Log user agent once for debugging
  if (!userAgentLogged) {
    console.log(`[NativeApp] User-Agent: ${navigator.userAgent}`);
    console.log(`[NativeApp] Contains MyQRLWallet: ${navigator.userAgent.includes('MyQRLWallet')}`);
    userAgentLogged = true;
  }

  return navigator.userAgent.includes('MyQRLWallet');
};

/**
 * Send a message to the native app
 * Only works when running inside the native WebView
 */
export const sendToNative = (
  type: WebToNativeMessageType,
  payload?: Record<string, unknown>
): boolean => {
  const webView = window.ReactNativeWebView;

  if (webView?.postMessage) {
    webView.postMessage(JSON.stringify({ type, payload }));
    return true;
  }

  console.warn('[NativeApp] Not running in native app, message not sent:', type);
  return false;
};

/**
 * Request QR code scanning from the native app
 */
export const requestQRScan = (): boolean => {
  return sendToNative('SCAN_QR');
};

/**
 * Copy text to clipboard via native app (bridge only)
 */
export const copyToClipboardNative = (text: string): boolean => {
  return sendToNative('COPY_TO_CLIPBOARD', { text });
};

/**
 * Copy text to clipboard - uses native bridge when in app, browser API otherwise
 * This is the preferred function to use for clipboard operations
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (isInNativeApp()) {
    return sendToNative('COPY_TO_CLIPBOARD', { text });
  }

  // Fall back to browser clipboard API
  if (!navigator.clipboard) {
    console.error("Clipboard API is not available.");
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error("Failed to copy text to clipboard:", err);
    return false;
  }
};

/**
 * Share content via native share sheet
 */
export const shareContent = (options: {
  title?: string;
  text?: string;
  url?: string;
}): boolean => {
  return sendToNative('SHARE', options);
};

/**
 * Notify native app of a confirmed transaction
 * (for push notification purposes)
 */
export const notifyTransactionConfirmed = (
  txHash: string,
  txType: 'incoming' | 'outgoing'
): boolean => {
  return sendToNative('TX_CONFIRMED', { txHash, type: txType });
};

/**
 * Send log message to native app for debugging
 */
export const logToNative = (message: string): boolean => {
  return sendToNative('LOG', { message });
};

/**
 * Open an external URL - uses native browser when in app, window.open otherwise
 * This is the preferred function to use for external links
 */
export const openExternalUrl = (url: string): void => {
  if (isInNativeApp()) {
    sendToNative('OPEN_URL', { url });
  } else {
    window.open(url, '_blank');
  }
};

/**
 * Trigger haptic feedback on the device
 * Only works in native app context
 * @param style - 'success' | 'warning' | 'error' | 'light' | 'medium' | 'heavy'
 */
export const triggerHaptic = (style: 'success' | 'warning' | 'error' | 'light' | 'medium' | 'heavy' = 'success'): void => {
  if (isInNativeApp()) {
    sendToNative('HAPTIC', { style });
  }
};

/**
 * Subscribe to messages from the native app
 * Returns an unsubscribe function
 */
export const subscribeToNativeMessages = (
  callback: (message: NativeMessage) => void
): (() => void) => {
  const handler = (event: Event) => {
    // Verify it's a CustomEvent before accessing detail
    if (!(event instanceof CustomEvent)) {
      console.warn('[NativeApp] Expected CustomEvent but received:', event.type);
      return;
    }
    if (event.detail) {
      callback(event.detail as NativeMessage);
    }
  };

  window.addEventListener('nativeMessage', handler);

  return () => {
    window.removeEventListener('nativeMessage', handler);
  };
};

// ============================================================
// Native-Injected PIN Storage (for biometric unlock)
// ============================================================

// In-memory store for PIN injected by native app after biometric unlock
// This is intentionally NOT in localStorage for security - it's cleared on page refresh
let nativeInjectedPin: string | null = null;

/**
 * Store a PIN injected by the native app (after biometric unlock)
 * This PIN can be used for transaction signing without prompting the user
 */
export const setNativeInjectedPin = (pin: string): void => {
  nativeInjectedPin = pin;
};

/**
 * Get the PIN injected by the native app
 * Returns null if no PIN has been injected
 */
export const getNativeInjectedPin = (): string | null => {
  return nativeInjectedPin;
};

/**
 * Clear the native-injected PIN
 * Called when wallet is cleared or user wants to re-authenticate
 */
export const clearNativeInjectedPin = (): void => {
  nativeInjectedPin = null;
};

/**
 * Check if a PIN has been injected by the native app
 */
export const hasNativeInjectedPin = (): boolean => {
  return nativeInjectedPin !== null;
};

// ============================================================
// Seed Persistence Functions (for native app integration)
// ============================================================

/**
 * Notify native app that a seed has been stored
 * Native app will backup the encrypted seed and prompt for biometric setup
 */
export const notifySeedStored = (options: {
  address: string;
  encryptedSeed: string;
  blockchain: string;
}): boolean => {
  return sendToNative('SEED_STORED', options);
};

/**
 * Request native app to unlock with biometric authentication
 * If successful, native will send UNLOCK_WITH_PIN with the stored PIN
 */
export const requestBiometricUnlock = (): boolean => {
  return sendToNative('REQUEST_BIOMETRIC_UNLOCK');
};

/**
 * Confirm to native app that web has cleared its wallet data
 */
export const confirmWalletCleared = (): boolean => {
  return sendToNative('WALLET_CLEARED');
};

/**
 * Notify native app that web app is fully initialized and ready to receive data
 * Should be called after the app is mounted and ready for native-to-web messages
 */
export const notifyWebAppReady = (): boolean => {
  return sendToNative('WEB_APP_READY');
};

/**
 * Request native app to open its settings screen
 * Used when user clicks settings in web UI while running in native app
 */
export const openNativeSettings = (): boolean => {
  return sendToNative('OPEN_NATIVE_SETTINGS');
};

// ============================================================
// QR Result Handler (for component-level QR scan handling)
// ============================================================

/**
 * Simple single-handler storage for QR scan results.
 * Note: This is a basic implementation that supports one handler at a time.
 * If multiple components need to listen for QR results simultaneously,
 * consider migrating to a MobX store or pub/sub pattern.
 */
let pendingQRResultHandler: ((address: string) => void) | null = null;

/**
 * Register a handler for QR scan results.
 * Only one handler can be active at a time - the last registered handler wins.
 * Returns an unsubscribe function to clear the handler.
 */
export const registerQRResultHandler = (
  handler: (address: string) => void
): (() => void) => {
  pendingQRResultHandler = handler;

  return () => {
    if (pendingQRResultHandler === handler) {
      pendingQRResultHandler = null;
    }
  };
};

/**
 * Dispatch a QR result to the registered handler (if any)
 * Called internally by NativeAppBridge when QR_RESULT message is received
 */
export const dispatchQRResult = (address: string): boolean => {
  if (pendingQRResultHandler) {
    pendingQRResultHandler(address);
    return true;
  }
  return false;
};
