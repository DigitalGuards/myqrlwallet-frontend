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
  | 'DEVICE_CREDENTIAL_REQUEST' // Get/create the hardware-backed v5 wallet factor
  | 'REQUEST_BIOMETRIC_UNLOCK'  // Web asks native to unlock with biometric
  | 'WALLET_CLEARED'        // Web confirmed it cleared localStorage
  | 'WEB_APP_READY'         // Web app is fully initialized and ready to receive data
  | 'WEB_DOCUMENT_READY'    // Web echoes the native document challenge
  | 'PIN_VERIFIED'          // Web responds to PIN verification request
  | 'PIN_CHANGED'           // Web responds to PIN change request
  | 'CONTACTS_UPDATED'      // Web address book changed, native should back it up
  // Navigation messages
  | 'OPEN_NATIVE_SETTINGS'  // Request native app to open its settings screen
  // DApp Connect messages
  | 'DAPP_SHOW_WEBVIEW'     // Request native to show/focus WebView (for approval modal)
  | 'DAPP_CONNECTED'        // Notify native that a dApp connected
  | 'DAPP_DISCONNECTED'     // Notify native that a dApp disconnected
  | 'DAPP_DISCONNECT_RESPONSE' // Correlated durable disconnect result
  | 'DAPP_HAPTIC'           // Trigger haptic for dApp approve/reject
  | 'DAPP_RETURN';          // Bounce back to the dApp after approval (peer redirect)

/**
 * Message types that can be received from the native app
 */
export type NativeToWebMessageType =
  | 'QR_RESULT'
  | 'QR_CANCELLED'          // User closed QR scanner without scanning
  | 'BIOMETRIC_SUCCESS'
  | 'APP_STATE'
  | 'CLIPBOARD_SUCCESS'
  | 'SHARE_SUCCESS'
  | 'ERROR'
  // Seed persistence messages
  | 'UNLOCK_WITH_PIN'       // Native sends PIN after biometric success
  | 'RESTORE_SEED'          // Native sends backup seed if localStorage empty
  | 'WEB_DOCUMENT_CHALLENGE' // Native proves this exact WebView document is current
  | 'CLEAR_WALLET'          // Native requests web to clear wallet
  | 'BIOMETRIC_SETUP_PROMPT' // Native prompts user to enable biometric
  | 'VERIFY_PIN'            // Native asks web to verify PIN can decrypt seed
  | 'CHANGE_PIN'            // Native requests web to re-encrypt seeds with new PIN
  | 'SEED_STORED_RESPONSE'  // Native durably acknowledged a seed backup revision
  | 'DEVICE_CREDENTIAL_RESPONSE' // Native returns the hardware-backed v5 wallet factor
  // DApp Connect messages
  | 'DAPP_URI'              // Deep link URI received by native, forwarded to WebView
  | 'DAPP_DISCONNECT'       // Native requests web to disconnect a specific dApp session
  // Display preferences (native settings drives the Home card toggles)
  | 'SET_DISPLAY_PREFS'     // Native sets showTokensCard / showNftsCard in wallet settings
  | 'RESTORE_CONTACTS'      // Native sends the backed-up address book on boot
  | 'NAVIGATE';             // Native asks the web app to navigate to an in-app route

export interface NativeMessage {
  type: NativeToWebMessageType;
  payload?: Record<string, unknown>;
}

// Module evaluation happens once per full WebView document. A same-origin
// navigation creates a new module graph and therefore a new unguessable id.
const CURRENT_DOCUMENT_ID = randomRequestId();

export const getCurrentNativeDocumentId = (): string => CURRENT_DOCUMENT_ID;

export const isNativeMessageForCurrentDocument = (
  message: unknown,
): message is NativeMessage => {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return false;
  }
  const record = message as Record<string, unknown>;
  const payload = record['payload'];
  return (
    typeof record['type'] === 'string' &&
    typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>)['documentId'] === CURRENT_DOCUMENT_ID
  );
};

/**
 * Check if the web app is running inside the native MyQRLWallet app
 */
export const isInNativeApp = (): boolean => {
  if (typeof navigator === 'undefined') return false;
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
    webView.postMessage(
      JSON.stringify({
        type,
        payload: { ...(payload ?? {}), documentId: CURRENT_DOCUMENT_ID },
      }),
    );
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
    const sent = sendToNative('COPY_TO_CLIPBOARD', { text });
    if (sent) return true;
    // Native bridge unavailable, fall through to browser API
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

/** Parse external navigation at the hosted-wallet trust boundary. */
export const parseExternalHttpUrl = (value: string): string | null => {
  if (value.length === 0 || value.length > 2048 || value.trim() !== value) return null;
  try {
    const parsed = new URL(value);
    const loopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname.endsWith('.localhost') ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]';
    if (
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.hostname === ''
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

/**
 * Open an external URL - uses native browser when in app, window.open otherwise
 * This is the preferred function to use for external links
 */
export const openExternalUrl = (url: string): void => {
  const safeUrl = parseExternalHttpUrl(url);
  if (safeUrl === null) {
    console.warn('[NativeApp] Refusing to open an unsafe external URL');
    return;
  }
  if (isInNativeApp()) {
    sendToNative('OPEN_URL', { url: safeUrl });
  } else {
    window.open(safeUrl, '_blank', 'noopener,noreferrer');
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
      const message = event.detail;
      if (isNativeMessageForCurrentDocument(message)) callback(message);
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
 * Every native lifecycle transition invalidates the WebView's cached PIN.
 * A fresh PIN is injected only after the native app completes Device Login.
 */
export const clearNativeInjectedPinForAppState = (): void => {
  clearNativeInjectedPin();
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

export type SeedBackupAcknowledgement = {
  revision: number;
  ciphertextHash: string;
};

type PendingSeedBackupRequest = {
  revision: number;
  ciphertextHash: string;
  resolve: (acknowledgement: SeedBackupAcknowledgement) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingSeedBackupRequests = new Map<string, PendingSeedBackupRequest>();
let seedBackupListenerInstalled = false;

/** SHA-256 identity for an exact encrypted-seed envelope. */
export async function hashEncryptedSeed(encryptedSeed: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptedSeed)),
  );
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function ensureSeedBackupListener(): void {
  if (seedBackupListenerInstalled || typeof window === 'undefined') return;

  window.addEventListener('nativeMessage', (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const message = event.detail as NativeMessage | undefined;
    if (message?.type !== 'SEED_STORED_RESPONSE') return;
    if (!isNativeMessageForCurrentDocument(message)) return;

    const requestId = message.payload?.['requestId'];
    if (typeof requestId !== 'string') return;
    const pending = pendingSeedBackupRequests.get(requestId);
    if (!pending) return;

    pendingSeedBackupRequests.delete(requestId);
    clearTimeout(pending.timeout);

    if (message.payload?.['success'] !== true) {
      pending.reject(new Error('Native secure seed backup failed.'));
      return;
    }
    const revision = message.payload?.['revision'];
    const ciphertextHash = message.payload?.['ciphertextHash'];
    if (revision !== pending.revision || ciphertextHash !== pending.ciphertextHash) {
      pending.reject(new Error('Native acknowledged a different seed backup revision.'));
      return;
    }
    pending.resolve({ revision, ciphertextHash });
  });

  seedBackupListenerInstalled = true;
}

/**
 * Ask native to durably back up one exact encrypted-seed revision. The promise
 * resolves only after native storage read-back confirms the same revision and
 * SHA-256 identity, so PIN rotation can wait for every backup before reporting
 * success.
 */
export const notifySeedStored = async (options: {
  address: string;
  encryptedSeed: string;
  blockchain: string;
  revision: number;
}): Promise<SeedBackupAcknowledgement> => {
  if (!isInNativeApp()) {
    throw new Error('Native secure seed backup is unavailable.');
  }
  if (!Number.isSafeInteger(options.revision) || options.revision < 1) {
    throw new Error('A valid encrypted-seed revision is required.');
  }

  ensureSeedBackupListener();
  const requestId = randomRequestId();
  const ciphertextHash = await hashEncryptedSeed(options.encryptedSeed);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingSeedBackupRequests.delete(requestId);
      reject(new Error('The native app did not confirm the secure seed backup.'));
    }, 10000);

    pendingSeedBackupRequests.set(requestId, {
      revision: options.revision,
      ciphertextHash,
      resolve,
      reject,
      timeout,
    });
    const sent = sendToNative('SEED_STORED', {
      ...options,
      requestId,
      ciphertextHash,
    });
    if (!sent) {
      clearTimeout(timeout);
      pendingSeedBackupRequests.delete(requestId);
      reject(new Error('The native wallet bridge is unavailable.'));
    }
  });
};

type DeviceCredentialRequest = {
  createIfMissing: boolean;
  candidate?: string;
};

type PendingDeviceCredentialRequest = {
  resolve: (credential: string | null) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingDeviceCredentialRequests = new Map<string, PendingDeviceCredentialRequest>();
let deviceCredentialListenerInstalled = false;

function randomRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let id = '';
  for (const byte of bytes) id += byte.toString(16).padStart(2, '0');
  return id;
}

function ensureDeviceCredentialListener(): void {
  if (deviceCredentialListenerInstalled || typeof window === 'undefined') return;

  window.addEventListener('nativeMessage', (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const message = event.detail as NativeMessage | undefined;
    if (message?.type !== 'DEVICE_CREDENTIAL_RESPONSE') return;
    if (!isNativeMessageForCurrentDocument(message)) return;

    const requestId = message.payload?.['requestId'];
    if (typeof requestId !== 'string') return;
    const pending = pendingDeviceCredentialRequests.get(requestId);
    if (!pending) return;

    pendingDeviceCredentialRequests.delete(requestId);
    clearTimeout(pending.timeout);

    const error = message.payload?.['error'];
    if (error === 'NOT_FOUND') {
      pending.resolve(null);
      return;
    }
    if (typeof error === 'string' && error) {
      pending.reject(new Error('Native secure storage could not provide the wallet credential.'));
      return;
    }

    const credential = message.payload?.['credential'];
    if (typeof credential !== 'string') {
      pending.reject(new Error('Native returned an invalid wallet credential response.'));
      return;
    }
    pending.resolve(credential);
  });

  deviceCredentialListenerInstalled = true;
}

/**
 * Request the independent v5 wallet factor from native Keychain/Keystore.
 * When creation is requested, native must confirm the supplied random
 * candidate was durably stored before resolving this promise.
 */
export function requestNativeDeviceCredential(
  options: DeviceCredentialRequest,
): Promise<string | null> {
  if (!isInNativeApp()) {
    return Promise.reject(new Error('Native secure storage is unavailable.'));
  }
  if (
    options.createIfMissing &&
    (typeof options.candidate !== 'string' || !/^[0-9a-f]{64}$/.test(options.candidate))
  ) {
    return Promise.reject(new Error('A valid device credential candidate is required.'));
  }

  ensureDeviceCredentialListener();
  const requestId = randomRequestId();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingDeviceCredentialRequests.delete(requestId);
      reject(
        new Error(
          'The native app did not confirm secure wallet storage. Update the app and try again.',
        ),
      );
    }, 3000);

    pendingDeviceCredentialRequests.set(requestId, { resolve, reject, timeout });
    const sent = sendToNative('DEVICE_CREDENTIAL_REQUEST', {
      requestId,
      createIfMissing: options.createIfMissing,
      ...(options.candidate ? { candidate: options.candidate } : {}),
    });
    if (!sent) {
      clearTimeout(timeout);
      pendingDeviceCredentialRequests.delete(requestId);
      reject(new Error('The native wallet bridge is unavailable.'));
    }
  });
}

/**
 * Mirror the address book to native storage so contacts survive WebView
 * data loss; native persists them until an explicit Remove All Wallets.
 */
export const notifyContactsUpdated = (contacts: unknown[]): boolean => {
  return sendToNative('CONTACTS_UPDATED', { contacts });
};

/**
 * Request native app to unlock with biometric authentication
 * If successful, native will send UNLOCK_WITH_PIN with the stored PIN
 */
export const requestBiometricUnlock = (): boolean => {
  return sendToNative('REQUEST_BIOMETRIC_UNLOCK');
};

const CORRELATION_ID_PATTERN = /^[0-9a-f]{32}$/;
const DAPP_CHANNEL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function correlationPayload(
  requestId: string,
  success: boolean,
  error?: string,
): Record<string, unknown> | null {
  if (!CORRELATION_ID_PATTERN.test(requestId)) return null;
  return { requestId, success, ...(error === undefined ? {} : { error }) };
}

/**
 * Confirm to native app that web has cleared its wallet data
 */
export const confirmWalletCleared = (
  requestId: string,
  success: boolean,
  error?: string,
): boolean => {
  const payload = correlationPayload(requestId, success, error);
  return payload ? sendToNative('WALLET_CLEARED', payload) : false;
};

/**
 * Send PIN verification result to native app
 */
export const sendPinVerified = (
  requestId: string,
  success: boolean,
  error?: string,
): boolean => {
  const payload = correlationPayload(requestId, success, error);
  return payload ? sendToNative('PIN_VERIFIED', payload) : false;
};

/** Reply only after the requested dApp session is durably removed. */
export const sendDAppDisconnectResponse = (
  requestId: string,
  channelId: string,
  success: boolean,
  error?: string,
): boolean => {
  const payload = correlationPayload(requestId, success, error);
  if (!payload || !DAPP_CHANNEL_ID_PATTERN.test(channelId)) return false;
  return sendToNative('DAPP_DISCONNECT_RESPONSE', {
    ...payload,
    channelId,
  });
};

/**
 * Send PIN change result to native app
 * Called after web re-encrypts all seeds with the new PIN
 */
export const sendPinChanged = (
  requestId: string,
  success: boolean,
  newPin?: string,
  error?: string,
): boolean => {
  return sendToNative('PIN_CHANGED', { requestId, success, newPin, error });
};

/**
 * Notify native app that web app is fully initialized and ready to receive data
 * Should be called after the app is mounted and ready for native-to-web messages
 */
export const notifyWebAppReady = (): boolean => {
  return sendToNative('WEB_APP_READY');
};

/** Echo the exact native challenge for this full WebView document. */
export const confirmWebDocumentReady = (challengeId: string): boolean => {
  if (!CORRELATION_ID_PATTERN.test(challengeId)) return false;
  return sendToNative('WEB_DOCUMENT_READY', { challengeId });
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
