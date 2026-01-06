import { handleLogout } from '../logout';
import StorageUtil from './storage';
import { isInNativeApp } from '../nativeApp';

let autoLockTimer: NodeJS.Timeout | null = null;
let lastActivityTime: number = Date.now();
let navigateFunction: ((path: string) => void) | null = null;
let timeoutMs: number = 0;
let timerStartTime: number = 0;
let isActivityTrackingInitialized = false;

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

    // If user has been inactive for longer than the timeout, log them out
    if (inactiveTime >= timeoutMs) {
      console.log(`🔐 Auto-lock: TRIGGERED - No activity detected for ${minutes.toFixed(1)} minutes`);
      if (navigateFunction) {
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

  // Listen for storage changes to detect settings updates and account changes
  window.addEventListener('storage', async (event) => {
    if (event.key?.includes('WALLET_SETTINGS')) {
      console.log("⚙️ Auto-lock: Settings changed, restarting timer");
      await restartAutoLockTimer();
    }

    // If active account changes, restart the timer (wallet imported or changed)
    if (event.key?.includes('ACTIVE_ACCOUNT')) {
      console.log("👛 Auto-lock: Wallet status changed, checking if auto-lock should be enabled");
      await checkAndStartAutoLock();
    }
  });

  // Also listen for localStorage changes in the current window
  // This helps catch changes that don't trigger the storage event in the same window
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function(key, value) {
    // Call the original function first
    originalSetItem.apply(this, [key, value]);

    // Then handle the change if it's related to accounts
    if (key.includes('ACTIVE_ACCOUNT')) {
      setTimeout(async () => {
        console.log("👛 Auto-lock: Active account changed in current window");
        await checkAndStartAutoLock();
      }, 500); // Small delay to ensure storage is updated
    }
  };

  isActivityTrackingInitialized = true;
  console.log("👁️ Auto-lock: Activity tracking initialized");
};
