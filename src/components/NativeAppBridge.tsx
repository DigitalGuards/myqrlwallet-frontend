/**
 * NativeAppBridge Component
 *
 * Listens for messages from the native MyQRLWallet app and dispatches
 * them to appropriate handlers. Mount this at the app root.
 */

import { useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router";
import {
  isInNativeApp,
  subscribeToNativeMessages,
  type NativeMessage,
  type NativeToWebMessageType,
  logToNative,
  setNativeInjectedPin,
  clearNativeInjectedPin,
  clearNativeInjectedPinForAppState,
  confirmWalletCleared,
  confirmWebDocumentReady,
  notifyWebAppReady,
  dispatchQRResult,
  sendPinVerified,
  sendDAppDisconnectResponse,
  sendPinChanged,
  notifySeedStored,
  hashEncryptedSeed,
} from "@/utils/nativeApp";
import {
  DAppConnectService,
  dappConnectService,
} from "@/services/dappConnect/DAppConnectService";
import { WalletEncryptionUtil } from "@/utils/crypto/walletEncryption";
import {
  decryptStoredSeedAsync,
  CryptoOperationError,
  CryptoErrorCode,
} from "@/utils/crypto";
import { rotateStoredSeedPinWithTargetFallback } from "@/utils/crypto/pinRotation";
import { clearDeviceCredential } from "@/utils/crypto/deviceCredential";
import { ROUTES } from "@/router/router";
import StorageUtil from "@/utils/storage/storage";
import { clearAddressBook, mergeContacts } from "@/utils/addressBook";
import { QRL_PROVIDER } from "@/config";
import { store } from "@/stores/store";
import {
  walletMutations,
  type WalletMutationGuard,
} from "@/utils/nativeWalletMutation";
import {
  disconnectMobile,
  hasMobileSession,
} from "@/utils/mobileConnect/mobileConnection";
import { Q_ADDRESS_PATTERN } from "@/services/dappConnect/accountBinding";

const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/;
const CHANNEL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pendingPinVerifications = new Set<string>();
const pendingDAppDisconnects = new Set<string>();
const pendingWalletClears = new Set<string>();
const DOCUMENT_READY_RETRY_MS = 500;
const DOCUMENT_READY_MAX_ATTEMPTS = 30;

/** Error messages for PIN verification - forms API contract with native app */
const PIN_VERIFY_ERRORS = {
  INVALID_FORMAT: "Invalid PIN format",
  NO_ACTIVE_ACCOUNT: "No active account",
  NO_ENCRYPTED_SEED: "No encrypted seed found",
  INCORRECT_PIN: "Incorrect PIN",
  DEVICE_CREDENTIAL: "Wallet device credential unavailable",
} as const;

/** Error messages for PIN change - forms API contract with native app */
const PIN_CHANGE_ERRORS = {
  INVALID_OLD_PIN: "Invalid old PIN format",
  INVALID_NEW_PIN: "Invalid new PIN format",
  NO_ENCRYPTED_SEEDS: "No encrypted seeds found",
  INCORRECT_PIN: "Incorrect current PIN",
} as const;

/**
 * Restores account state after RESTORE_SEED message.
 * Updates MobX store directly instead of reloading the page.
 */
async function restoreAccountState(
  blockchain: string,
  address: string,
): Promise<void> {
  try {
    const { qrlStore } = store;
    const currentActive = await StorageUtil.getActiveAccount(blockchain);

    if (!currentActive) {
      // Set as active account - qrlStore.setActiveAccount handles:
      // - Adding to account list
      // - Fetching balances
      // - Token discovery
      await qrlStore.setActiveAccount(address, "seed");
      logToNative(`Set ${address} as active account via store`);
      return;
    }

    // Active account exists - ensure restored account is in the list
    const accountList = await StorageUtil.getAccountList(blockchain);
    if (
      !accountList.some(
        (item) => item.address.toLowerCase() === address.toLowerCase(),
      )
    ) {
      await StorageUtil.setAccountList(blockchain, [
        ...accountList,
        { address, source: "seed" },
      ]);
      logToNative(`Added ${address} to account list`);
      // Refresh accounts to pick up the new one
      await qrlStore.fetchAccounts();
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[Bridge] Error restoring account state:", error);
    logToNative(`Error restoring account state: ${errorMsg}`);
  }
}

/**
 * Handles CHANGE_PIN request from native app.
 * Re-encrypts all seeds with the new PIN using Web Worker.
 */
async function handleChangePinRequest(
  requestId: string,
  oldPin: string,
  newPin: string,
  acceptAlreadyTarget: boolean,
  isCurrent: WalletMutationGuard,
): Promise<void> {
  try {
    const { rotatedSeeds } = await rotateStoredSeedPinWithTargetFallback(
      {
        blockchains: Object.keys(QRL_PROVIDER),
        oldPin,
        newPin,
        backup: (record) => notifySeedStored(record),
        walletEpoch: isCurrent.epoch,
        isCurrent,
      },
      acceptAlreadyTarget,
    );

    if (!isCurrent()) {
      logToNative("Discarded PIN change result because the wallet was cleared");
      sendPinChanged(
        requestId,
        false,
        undefined,
        "Wallet was cleared during PIN change.",
      );
      return;
    }
    logToNative(`PIN changed successfully for ${rotatedSeeds} wallet(s)`);
    sendPinChanged(requestId, true, newPin);
  } catch (error) {
    console.error("[Bridge] Error changing PIN:", error);

    if (!isCurrent()) {
      logToNative("PIN change failed because the wallet was cleared");
      sendPinChanged(
        requestId,
        false,
        undefined,
        "Wallet was cleared during PIN change.",
      );
      return;
    }

    // Check error code for proper handling
    if (
      error instanceof CryptoOperationError &&
      error.code === CryptoErrorCode.INCORRECT_PIN
    ) {
      logToNative("PIN change failed: incorrect current PIN");
      sendPinChanged(
        requestId,
        false,
        undefined,
        PIN_CHANGE_ERRORS.INCORRECT_PIN,
      );
    } else if (
      error instanceof Error &&
      error.message === "No encrypted seeds found"
    ) {
      logToNative("No encrypted seeds found to re-encrypt");
      sendPinChanged(
        requestId,
        false,
        undefined,
        PIN_CHANGE_ERRORS.NO_ENCRYPTED_SEEDS,
      );
    } else {
      // Don't expose internal error details to native app
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logToNative(`PIN change failed: ${errorMessage}`);
      sendPinChanged(
        requestId,
        false,
        undefined,
        "An unexpected error occurred during PIN change.",
      );
    }
  }
}

async function handleCorrelatedPinVerification(
  requestId: string,
  pin: string,
): Promise<void> {
  if (pendingPinVerifications.has(requestId)) return;
  pendingPinVerifications.add(requestId);
  const generation = walletMutations.captureGeneration();
  try {
    await walletMutations.enqueueWalletMutation(
      async (isCurrent) => {
        let blockchain: string;
        let activeAccount: string;
        let encryptedSeed: string;
        try {
          blockchain = await StorageUtil.getBlockChain();
          const storedAccount = await StorageUtil.getActiveAccount(blockchain);
          if (!storedAccount) {
            sendPinVerified(
              requestId,
              false,
              PIN_VERIFY_ERRORS.NO_ACTIVE_ACCOUNT,
            );
            return;
          }
          activeAccount = storedAccount;
          const storedSeed = await StorageUtil.getEncryptedSeed(
            blockchain,
            activeAccount,
          );
          if (!storedSeed) {
            sendPinVerified(
              requestId,
              false,
              PIN_VERIFY_ERRORS.NO_ENCRYPTED_SEED,
            );
            return;
          }
          encryptedSeed = storedSeed;
        } catch (error) {
          console.error("[Bridge] Storage error during PIN verification:", error);
          sendPinVerified(requestId, false, "Storage error");
          return;
        }

        try {
          await decryptStoredSeedAsync(
            blockchain,
            activeAccount,
            encryptedSeed,
            pin,
          );
          if (!isCurrent()) {
            sendPinVerified(
              requestId,
              false,
              "Wallet changed during PIN verification",
            );
            return;
          }
          sendPinVerified(requestId, true);
        } catch (error) {
          if (!isCurrent()) {
            sendPinVerified(
              requestId,
              false,
              "Wallet changed during PIN verification",
            );
          } else if (
            error instanceof CryptoOperationError &&
            error.code === CryptoErrorCode.DEVICE_CREDENTIAL_UNAVAILABLE
          ) {
            sendPinVerified(
              requestId,
              false,
              PIN_VERIFY_ERRORS.DEVICE_CREDENTIAL,
            );
          } else {
            sendPinVerified(requestId, false, PIN_VERIFY_ERRORS.INCORRECT_PIN);
          }
        }
      },
      () => {
        sendPinVerified(
          requestId,
          false,
          "Wallet changed during PIN verification",
        );
      },
      generation,
    );
  } finally {
    pendingPinVerifications.delete(requestId);
  }
}

async function assertWalletClearPostconditions(): Promise<void> {
  for (const blockchain of Object.keys(QRL_PROVIDER)) {
    if ((await StorageUtil.getActiveAccount(blockchain)) !== "") {
      throw new Error("active account remains after clear");
    }
    if ((await StorageUtil.getAllEncryptedSeeds(blockchain)).length !== 0) {
      throw new Error("encrypted seed remains after clear");
    }
    if ((await StorageUtil.getAccountList(blockchain)).length !== 0) {
      throw new Error("account list remains after clear");
    }
  }
  if (store.qrlStore.activeAccount.accountAddress !== "") {
    throw new Error("runtime account remains after clear");
  }
  if (dappConnectService.getActiveSessions().length !== 0) {
    throw new Error("QRL Connect session remains after clear");
  }
  if (hasMobileSession()) {
    throw new Error("mobile signer session remains after clear");
  }
}

/**
 * Main bridge component - mount at app root
 */
const NativeAppBridge: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const documentChallengeEchoed = useRef(false);
  const readyRetryTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopReadyRetries = useCallback(() => {
    if (readyRetryTimer.current !== null) {
      clearInterval(readyRetryTimer.current);
      readyRetryTimer.current = null;
    }
  }, []);

  const handleNativeMessage = useCallback(
    (message: NativeMessage) => {
      const { type, payload } = message;

      // subscribeToNativeMessages has already enforced this document's id.
      // A non-challenge arriving after our exact echo proves native activated
      // this document, so READY retries are no longer needed.
      if (
        type !== ("WEB_DOCUMENT_CHALLENGE" as NativeToWebMessageType) &&
        documentChallengeEchoed.current
      ) {
        stopReadyRetries();
      }

      switch (type) {
        case "WEB_DOCUMENT_CHALLENGE" as NativeToWebMessageType: {
          const challengeId = payload?.["challengeId"];
          if (
            typeof challengeId !== "string" ||
            !REQUEST_ID_PATTERN.test(challengeId)
          ) {
            console.warn("[Bridge] Invalid web document challenge");
            return;
          }
          if (confirmWebDocumentReady(challengeId)) {
            documentChallengeEchoed.current = true;
          }
          break;
        }

        case "QR_RESULT": {
          const address = payload?.["address"];
          if (typeof address !== "string" || !address) {
            console.warn("[Bridge] QR result missing or invalid address");
            return;
          }

          // Classify the bearer URI before any logging. Its q= payload contains
          // the PQP3 capability and must never reach native/Metro logs.
          if (/^qrlconnect:/i.test(address)) {
            if (!DAppConnectService.isConnectionURI(address)) {
              logToNative("Rejected malformed dApp connection URI");
              return;
            }
            logToNative("DApp connection URI detected");
            // QR scan => the dApp is on another device; no same-device
            // return-to-dApp redirect after approval. handleConnectionURI
            // resolves with {success:false} rather than throwing, so log the
            // reason instead of letting a failed connect die silently.
            void dappConnectService
              .handleConnectionURI(address, "qr")
              .then((r) => {
                if (!r.success) logToNative("DApp connection failed");
              })
              .catch(() => logToNative("DApp connection failed"));
            return;
          }

          logToNative("QR result received");

          // If there's a registered handler, dispatch to it
          if (dispatchQRResult(address)) {
            return;
          }

          // Otherwise, navigate to transfer page with the address
          const searchParams = new URLSearchParams(location.search);
          searchParams.set("to", address);
          navigate(`${ROUTES.TRANSFER}?${searchParams.toString()}`);
          break;
        }

        case "BIOMETRIC_SUCCESS": {
          const authenticated = payload?.["authenticated"];
          if (typeof authenticated !== "boolean") {
            console.warn(
              "[Bridge] BIOMETRIC_SUCCESS missing or invalid authenticated flag",
            );
            return;
          }
          logToNative(`Biometric auth result: ${authenticated}`);
          // Could dispatch to store or trigger app unlock
          break;
        }

        case "APP_STATE": {
          const state = payload?.["state"];
          if (
            state !== "active" &&
            state !== "background" &&
            state !== "inactive"
          ) {
            console.warn("[Bridge] APP_STATE missing or invalid state");
            return;
          }
          // The old biometric PIN must never survive a lock transition. Clear
          // on active too, before native can inject a freshly authenticated PIN.
          clearNativeInjectedPinForAppState();
          logToNative(`App state changed: ${state}`);
          // Reconnect dApp sessions when app returns to foreground
          if (state === "active") {
            dappConnectService.reconnectAll();
          }
          break;
        }

        // Deep link URI from native app (qrlconnect:// scheme)
        case "DAPP_URI" as NativeToWebMessageType: {
          const uri = payload?.["uri"];
          if (typeof uri !== "string" || !uri) {
            console.warn("[Bridge] DAPP_URI missing or invalid uri");
            return;
          }
          if (!DAppConnectService.isConnectionURI(uri)) {
            logToNative("Rejected malformed dApp deep link");
            return;
          }
          logToNative("DApp connection URI received via deep link");
          // Deep link => same-device flow; enable the return-to-dApp redirect.
          void dappConnectService
            .handleConnectionURI(uri, "deeplink")
            .then((r) => {
              if (!r.success) logToNative("DApp connection failed");
            })
            .catch(() => logToNative("DApp connection failed"));
          break;
        }

        // Native requests disconnect of a specific dApp session
        case "DAPP_DISCONNECT" as NativeToWebMessageType: {
          const requestId = payload?.["requestId"];
          const channelId = payload?.["channelId"];
          if (
            typeof requestId !== "string" ||
            !REQUEST_ID_PATTERN.test(requestId) ||
            typeof channelId !== "string" ||
            !CHANNEL_ID_PATTERN.test(channelId)
          ) {
            console.warn("[Bridge] DAPP_DISCONNECT has invalid correlation fields");
            return;
          }
          if (pendingDAppDisconnects.has(requestId)) return;
          pendingDAppDisconnects.add(requestId);
          void dappConnectService
            .disconnectSession(channelId, true)
            .then((success) => {
              sendDAppDisconnectResponse(
                requestId,
                channelId,
                success,
                success ? undefined : "Session teardown was not confirmed",
              );
            })
            .catch(() => {
              sendDAppDisconnectResponse(
                requestId,
                channelId,
                false,
                "Session teardown failed",
              );
            })
            .finally(() => pendingDAppDisconnects.delete(requestId));
          break;
        }

        case "SET_DISPLAY_PREFS" as NativeToWebMessageType: {
          // The native app's own Settings tab drives the Home Tokens/NFTs card
          // toggles. Merge the provided booleans into wallet settings;
          // setWalletSettings dispatches STORAGE_EVENT_WALLET_SETTINGS, which
          // Home listens for, so the cards update without a reload.
          (async () => {
            try {
              const { showTokensCard, showNftsCard } = (payload ||
                {}) as Record<string, unknown>;
              const current = await StorageUtil.getWalletSettings();
              const next = { ...current };

              if (typeof showTokensCard === "boolean") {
                next.showTokensCard = showTokensCard;
              }
              if (typeof showNftsCard === "boolean") {
                next.showNftsCard = showNftsCard;
              }
              await StorageUtil.setWalletSettings(next);
            } catch (error) {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              console.error(
                "[Bridge] Error applying SET_DISPLAY_PREFS:",
                error,
              );
              logToNative(`Error applying display prefs: ${errorMsg}`);
            }
          })();
          break;
        }

        case "RESTORE_CONTACTS" as NativeToWebMessageType: {
          // Native pushes its address-book backup on boot; merge it in
          // (union by address, local wins) so contacts survive WebView
          // data loss. mergeContacts syncs the union back to native.
          try {
            const { contacts } = (payload || {}) as Record<string, unknown>;
            mergeContacts(contacts);
          } catch (error) {
            console.error("[Bridge] Error restoring contacts:", error);
            logToNative(
              `Error restoring contacts: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        }

        case "NAVIGATE" as NativeToWebMessageType: {
          // Native settings rows deep-link into web routes (e.g. the
          // Address Book). Only plain in-app paths are accepted.
          const { path } = (payload || {}) as Record<string, unknown>;
          if (
            typeof path === "string" &&
            path.startsWith("/") &&
            !path.startsWith("//")
          ) {
            navigate(path);
          } else {
            console.warn("[Bridge] Ignored NAVIGATE with invalid path:", path);
          }
          break;
        }

        case "CLIPBOARD_SUCCESS":
          // Could show a toast notification
          console.log("[Bridge] Clipboard success");
          break;

        case "SHARE_SUCCESS":
          // Could show a toast notification
          console.log("[Bridge] Share success");
          break;

        case "ERROR":
          console.error("[Bridge] Native error:", payload?.["message"]);
          break;

        // Seed persistence messages
        case "UNLOCK_WITH_PIN": {
          const pin = payload?.["pin"];
          if (
            typeof pin !== "string" ||
            !WalletEncryptionUtil.validatePin(pin)
          ) {
            console.warn("[Bridge] UNLOCK_WITH_PIN missing or invalid pin");
            return;
          }
          logToNative("PIN received from native app");
          setNativeInjectedPin(pin);
          // The PIN is now available for transaction signing via getNativeInjectedPin()
          break;
        }

        case "RESTORE_SEED": {
          const address = payload?.["address"];
          const encryptedSeed = payload?.["encryptedSeed"];
          const blockchain = payload?.["blockchain"];
          const revision = payload?.["revision"] ?? 0;
          const ciphertextHash = payload?.["ciphertextHash"];

          if (
            typeof address !== "string" ||
            !Q_ADDRESS_PATTERN.test(address) ||
            typeof encryptedSeed !== "string" ||
            !encryptedSeed ||
            encryptedSeed.length > 256 * 1024 ||
            typeof blockchain !== "string" ||
            !(blockchain in QRL_PROVIDER) ||
            typeof revision !== "number" ||
            !Number.isSafeInteger(revision) ||
            revision < 0 ||
            (revision > 0 &&
              (typeof ciphertextHash !== "string" ||
                !/^[0-9a-f]{64}$/.test(ciphertextHash)))
          ) {
            console.warn(
              "[Bridge] RESTORE_SEED missing or invalid required fields",
            );
            return;
          }

          logToNative(
            `Considering native seed revision ${revision} for ${address}`,
          );

          void walletMutations.enqueueRestore(async (isCurrent) => {
            try {
              if (revision > 0) {
                const actualHash = await hashEncryptedSeed(encryptedSeed);
                if (actualHash !== ciphertextHash) {
                  throw new Error(
                    "Native seed backup hash does not match its ciphertext",
                  );
                }
              }
              if (!isCurrent()) return;
              const result = await StorageUtil.restoreEncryptedSeedIfNewer(
                blockchain,
                address,
                encryptedSeed,
                revision,
                isCurrent.epoch,
              );
              if (!isCurrent()) return;
              await restoreAccountState(blockchain, address);
              logToNative(
                result === "stored"
                  ? `Restored seed revision ${revision} for ${address}`
                  : `Kept equal/newer local seed for ${address}`,
              );
            } catch (error) {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              console.error(
                `[Bridge] Error restoring seed for ${address}:`,
                error,
              );
              logToNative(`Error restoring seed: ${errorMsg}`);
            }
          });
          break;
        }

        case "CLEAR_WALLET": {
          const requestId = payload?.["requestId"];
          if (
            typeof requestId !== "string" ||
            !REQUEST_ID_PATTERN.test(requestId)
          ) {
            console.warn("[Bridge] CLEAR_WALLET missing or invalid requestId");
            return;
          }
          if (pendingWalletClears.has(requestId)) return;
          pendingWalletClears.add(requestId);
          void (async () => {
            // Native app requests full wallet wipe (from native settings).
            logToNative("Clearing wallet data");
            clearNativeInjectedPin();

            const clearWebWalletStorage = async () => {
              for (const blockchain of Object.keys(QRL_PROVIDER)) {
                await StorageUtil.clearActiveAccount(blockchain);
                StorageUtil.clearAllEncryptedSeeds(blockchain);
                StorageUtil.clearAccountList(blockchain);
                await StorageUtil.clearTransactionValues(blockchain);
              }
              StorageUtil.clearAllTokenData();
              StorageUtil.clearAllNftData();
              clearAddressBook();
            };

            // A restore may already be inside qrlStore.setActiveAccount when the
            // wipe arrives. Clear once now and again after that restore settles.
            const { qrlStore } = store;
            await walletMutations.clear(clearWebWalletStorage, async () => {
              await clearDeviceCredential();
              await dappConnectService.clearAllSessions(false);
              await disconnectMobile();
              await qrlStore.setActiveAccount(undefined);
              navigate(ROUTES.HOME);
            });
            await assertWalletClearPostconditions();
            confirmWalletCleared(requestId, true);
            logToNative("Wallet cleared, navigated to home");
          })().catch((error) => {
            console.error("[Bridge] Error clearing wallet:", error);
            logToNative("Error clearing wallet data");
            confirmWalletCleared(
              requestId,
              false,
              "Web wallet clear failed",
            );
          }).finally(() => pendingWalletClears.delete(requestId));
          break;
        }

        case "BIOMETRIC_SETUP_PROMPT":
          // Native is prompting user to enable biometric - nothing to do in web
          logToNative("Biometric setup prompt shown");
          break;

        case "VERIFY_PIN": {
          // Native asks web to verify PIN can decrypt the stored seed
          const requestId = payload?.["requestId"];
          const pin = payload?.["pin"];
          if (
            typeof requestId !== "string" ||
            !REQUEST_ID_PATTERN.test(requestId)
          ) {
            console.warn("[Bridge] VERIFY_PIN missing or invalid requestId");
            return;
          }
          if (
            typeof pin !== "string" ||
            !WalletEncryptionUtil.validatePin(pin)
          ) {
            console.warn("[Bridge] VERIFY_PIN missing or invalid pin");
            sendPinVerified(
              requestId,
              false,
              PIN_VERIFY_ERRORS.INVALID_FORMAT,
            );
            return;
          }
          void handleCorrelatedPinVerification(requestId, pin);
          break;
        }

        case "DEVICE_CREDENTIAL_RESPONSE":
        case "SEED_STORED_RESPONSE":
          // Consumed by the correlated request/response maps in nativeApp.ts.
          break;

        case "CHANGE_PIN": {
          // Native app requests web to re-encrypt all seeds with a new PIN
          const oldPin = payload?.["oldPin"];
          const newPin = payload?.["newPin"];
          const requestId = payload?.["requestId"];
          const acceptAlreadyTarget = payload?.["acceptAlreadyTarget"] === true;

          if (
            typeof requestId !== "string" ||
            !/^[0-9a-f]{32}$/.test(requestId)
          ) {
            console.warn("[Bridge] CHANGE_PIN missing or invalid requestId");
            return;
          }

          if (
            typeof oldPin !== "string" ||
            !WalletEncryptionUtil.validatePin(oldPin)
          ) {
            console.warn("[Bridge] CHANGE_PIN missing or invalid oldPin");
            sendPinChanged(
              requestId,
              false,
              undefined,
              PIN_CHANGE_ERRORS.INVALID_OLD_PIN,
            );
            return;
          }

          if (
            typeof newPin !== "string" ||
            !WalletEncryptionUtil.validatePin(newPin)
          ) {
            console.warn("[Bridge] CHANGE_PIN missing or invalid newPin");
            sendPinChanged(
              requestId,
              false,
              undefined,
              PIN_CHANGE_ERRORS.INVALID_NEW_PIN,
            );
            return;
          }

          logToNative("Changing PIN for all encrypted seeds...");
          void walletMutations.enqueuePinChange(
            (isCurrent) =>
              handleChangePinRequest(
                requestId,
                oldPin,
                newPin,
                acceptAlreadyTarget,
                isCurrent,
              ),
            () => {
              sendPinChanged(
                requestId,
                false,
                undefined,
                "Wallet clear is in progress.",
              );
            },
          );
          break;
        }

        default:
          console.warn("[Bridge] Unknown message type:", type);
      }
    },
    [navigate, location.search, stopReadyRetries],
  );

  useEffect(() => {
    // Only set up listeners if running in native app
    if (!isInNativeApp()) {
      return;
    }

    console.log(
      "[NativeAppBridge] Running in native app, setting up listeners",
    );
    logToNative("Web app bridge initialized");

    const unsubscribe = subscribeToNativeMessages(handleNativeMessage);

    // Notify native app that web app is ready to receive data
    // after the listener exists. Retry the same document id for a bounded
    // window so a navigation/startup race cannot strand the WebView.
    documentChallengeEchoed.current = false;
    notifyWebAppReady();
    let attempts = 1;
    readyRetryTimer.current = setInterval(() => {
      if (attempts >= DOCUMENT_READY_MAX_ATTEMPTS) {
        stopReadyRetries();
        return;
      }
      attempts += 1;
      notifyWebAppReady();
    }, DOCUMENT_READY_RETRY_MS);
    logToNative("Web app ready signal sent");

    return () => {
      stopReadyRetries();
      unsubscribe();
    };
  }, [handleNativeMessage, stopReadyRetries]);

  // This component doesn't render anything
  return null;
};

export default NativeAppBridge;
