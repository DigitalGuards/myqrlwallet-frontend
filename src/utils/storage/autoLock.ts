import { handleLogout } from '../logout';
import StorageUtil, {
  STORAGE_EVENT_ACTIVE_ACCOUNT,
  STORAGE_EVENT_WALLET_SETTINGS,
} from './storage';
import { isInNativeApp } from '../nativeApp';
import { isDesktop, desktopSigner } from '@/desktop/bridge';

let autoLockTimer: NodeJS.Timeout | null = null;
let lastActivityTime: number = Date.now();
let navigateFunction: ((path: string) => void) | null = null;
let timeoutMs: number = 0;
let timerStartTime: number = 0;
let isActivityTrackingInitialized = false;
// Monotonic id for serializing concurrent startAutoLockTimer calls. When
// multiple async setup paths race (e.g. an active-account event arrives
// while a wallet-settings event is mid-await), only the latest request
// gets to install the setInterval — older ones detect they've been
// superseded and bail before creating an orphaned timer.
let timerSetupRequestId = 0;

/**
 * Checks if there's an active wallet that needs to be protected
 * @returns Promise<boolean> True if there's an active wallet, false otherwise
 */
export const hasActiveWallet = async (): Promise<boolean> => {
  // Get the current blockchain from storage
  const blockchain = await StorageUtil.getBlockChain();
  if (!blockchain) return false;

  // Check if there's an active account for this blockchain
  const activeAccount = await StorageUtil.getActiveAccount(blockchain);
  return !!activeAccount;
};

/**
 * Starts the auto-lock timer that will log out the user after the specified period of inactivity
 * @param navigate - The navigate function from react-router
 */
export const startAutoLockTimer = async (navigate: (path: string) => void) => {
  // Claim a request id before any await. If another setup call lands while
  // we're awaiting hasActiveWallet / getWalletSettings, its id will be
  // higher and we'll bail at the install point below — preventing the
  // orphan-timer race where two parallel setups both assign autoLockTimer
  // and the earlier one keeps ticking forever.
  const myRequestId = ++timerSetupRequestId;

  // Store the navigate function for later use
  navigateFunction = navigate;

  // Clear any existing timer
  clearAutoLockTimer();

  // Disable auto-lock when running in native app
  // Native app handles session persistence and has its own biometric unlock
  if (isInNativeApp()) {
    console.log("🔒 Auto-lock: DISABLED - Running in native app");
    return;
  }

  // Check if there's an active wallet
  const walletActive = await hasActiveWallet();
  if (!walletActive) {
    console.log("🔒 Auto-lock: No active wallet detected - Auto-lock disabled");
    return;
  }

  // Get the auto-lock timeout from settings (in milliseconds)
  const settings = await StorageUtil.getWalletSettings();
  timeoutMs = settings.autoLockTimeout;

  if (!timeoutMs || timeoutMs <= 0) {
    console.log("🔒 Auto-lock: DISABLED (timeout set to 0 or negative)");
    return; // Auto-lock is disabled
  }

  // Bail out if a newer setup request landed while we were awaiting above.
  // Without this, our `setInterval` below would orphan whatever timer the
  // newer request later installs (or vice versa) and we'd silently leak
  // a ticking interval.
  if (myRequestId !== timerSetupRequestId) {
    console.log("🔒 Auto-lock: superseded by newer setup request, abandoning install");
    return;
  }

  // Set the timer start time and last activity time to now
  timerStartTime = Date.now();
  lastActivityTime = Date.now();

  const minutes = timeoutMs / (60 * 1000);
  console.log(`🔒 Auto-lock: ENABLED - Will lock after ${minutes.toFixed(1)} minutes of inactivity`);

  // Start a new timer that checks for inactivity
  autoLockTimer = setInterval(async () => {
    // Re-check if there's still an active wallet
    const stillActive = await hasActiveWallet();
    if (!stillActive) {
      console.log("🔒 Auto-lock: Wallet no longer active - Auto-lock disabled");
      clearAutoLockTimer();
      return;
    }

    const now = Date.now();
    const inactiveTime = now - lastActivityTime;
    const remainingTime = timeoutMs - inactiveTime;

    if (remainingTime <= 60000 && remainingTime > 0) {
      // Only log when less than a minute remaining
      console.log(`⏱️ Auto-lock: ${(remainingTime / 1000).toFixed(0)} seconds until lock`);
    }

    // If user has been inactive for longer than the timeout, lock the wallet.
    if (inactiveTime >= timeoutMs) {
      console.log(`🔐 Auto-lock: TRIGGERED - No activity detected for ${minutes.toFixed(1)} minutes`);
      if (isDesktop) {
        // Desktop: drop the signer session but KEEP the seed (it lives in the
        // signer). A seed-wipe logout would force a re-import; here the user
        // just re-enters their password to unlock.
        desktopSigner.lock().catch((err) => {
          console.error('Auto-lock: signer lock failed', err);
        });
      } else if (navigateFunction) {
        handleLogout(navigateFunction);
      }
      clearAutoLockTimer();
    }
  }, 5000); // Check every 5 seconds
};

/**
 * Clears the auto-lock timer
 */
export const clearAutoLockTimer = () => {
  if (autoLockTimer) {
    clearInterval(autoLockTimer);
    autoLockTimer = null;
    console.log("🔓 Auto-lock: Timer cleared");
  }
};

/**
 * Updates the last activity time to prevent auto-lock
 */
export const updateLastActivity = () => {
  if (!autoLockTimer) return; // Don't log if timer isn't running

  const previousActivityTime = lastActivityTime;
  lastActivityTime = Date.now();

  // Only log activity reset if it's been more than 5 seconds since the last activity
  // to avoid console spam from continuous mouse movements
  if (lastActivityTime - previousActivityTime > 5000) {
    const elapsedMinutes = (lastActivityTime - timerStartTime) / (60 * 1000);
    const remainingMinutes = (timeoutMs - (lastActivityTime - previousActivityTime)) / (60 * 1000);

    console.log(`👆 Activity detected after ${elapsedMinutes.toFixed(1)} minutes - Timer reset (${remainingMinutes.toFixed(1)} minutes remaining)`);
  }
};

/**
 * Restarts the auto-lock timer with the updated settings
 * This should be called after changing the auto-lock timeout in settings
 */
export const restartAutoLockTimer = async () => {
  console.log("🔄 Auto-lock: Restarting timer with new settings");
  if (navigateFunction) {
    await startAutoLockTimer(navigateFunction);
  } else {
    console.warn("⚠️ Auto-lock: Cannot restart timer - navigate function not available");
  }
};

/**
 * Checks if an active wallet exists and starts the auto-lock timer if needed
 * This should be called whenever an account is imported or set as active
 */
export const checkAndStartAutoLock = async () => {
  console.log("👛 Auto-lock: Checking wallet status after account change");

  // Only proceed if we have the navigate function
  if (!navigateFunction) {
    console.warn("⚠️ Auto-lock: Cannot check wallet status - navigate function not available");
    return;
  }

  // Check if there's an active wallet now
  const walletActive = await hasActiveWallet();

  if (walletActive) {
    console.log("👛 Auto-lock: Active wallet detected, starting auto-lock timer");
    await startAutoLockTimer(navigateFunction);
  } else {
    console.log("👛 Auto-lock: No active wallet detected after check");
  }
};

/**
 * Attaches event listeners to track user activity
 */
export const setupActivityTracking = () => {
  // Guard SSR / test environments where `window` is undefined. Matches
  // the same guard on the dispatch side in storage.ts so the two halves
  // stay consistent.
  if (typeof window === 'undefined') {
    return;
  }

  // Prevent duplicate initialization
  if (isActivityTrackingInitialized) {
    return;
  }

  const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];

  // Add event listeners for user activity
  activityEvents.forEach(eventType => {
    window.addEventListener(eventType, () => {
      updateLastActivity();
    });
  });

  // Cross-tab storage updates. The native `storage` event only fires in
  // OTHER tabs (not the one that wrote), so we still need it for
  // multi-tab sync.
  window.addEventListener('storage', async (event) => {
    if (event.key?.includes('WALLET_SETTINGS')) {
      console.log("⚙️ Auto-lock: Settings changed (cross-tab), restarting timer");
      await restartAutoLockTimer();
    }

    if (event.key?.includes('ACTIVE_ACCOUNT')) {
      console.log("👛 Auto-lock: Wallet status changed (cross-tab), checking auto-lock");
      await checkAndStartAutoLock();
    }
  });

  // Same-tab storage updates. We previously monkey-patched
  // localStorage.setItem on the prototype to catch these — that
  // sprayed an async callback over every localStorage write app-wide
  // (including third-party libs') and was never torn down. Now
  // StorageUtil dispatches dedicated custom events from its
  // setActiveAccount / clearActiveAccount / setWalletSettings methods,
  // and we just subscribe to those.
  window.addEventListener(STORAGE_EVENT_ACTIVE_ACCOUNT, async () => {
    console.log("👛 Auto-lock: Active account changed (same-tab), checking auto-lock");
    await checkAndStartAutoLock();
  });
  window.addEventListener(STORAGE_EVENT_WALLET_SETTINGS, async () => {
    console.log("⚙️ Auto-lock: Settings changed (same-tab), restarting timer");
    await restartAutoLockTimer();
  });

  isActivityTrackingInitialized = true;
  console.log("👁️ Auto-lock: Activity tracking initialized");
};
