/**
 * PIN Attempt Tracker
 *
 * Provides brute force protection for PIN entry by tracking failed attempts
 * and enforcing lockouts after too many failures.
 */

const STORAGE_KEY = 'pin_attempt_tracker';
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

interface AttemptData {
  failedAttempts: number;
  lockoutUntil: number | null;
  lastAttemptTime: number;
}

function getAttemptData(): AttemptData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return { failedAttempts: 0, lockoutUntil: null, lastAttemptTime: 0 };
}

function setAttemptData(data: AttemptData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * Check if PIN attempts are currently locked out
 * @returns Object with isLocked status and remainingMs if locked
 */
export function checkLockout(): { isLocked: boolean; remainingMs: number } {
  const data = getAttemptData();

  if (data.lockoutUntil) {
    const now = Date.now();
    if (now < data.lockoutUntil) {
      return { isLocked: true, remainingMs: data.lockoutUntil - now };
    }
    // Lockout expired, reset
    setAttemptData({ failedAttempts: 0, lockoutUntil: null, lastAttemptTime: 0 });
  }

  return { isLocked: false, remainingMs: 0 };
}

/**
 * Record a failed PIN attempt
 * @returns Object with isLocked status, remainingMs, and attemptsLeft
 */
export function recordFailedAttempt(): { isLocked: boolean; remainingMs: number; attemptsLeft: number } {
  const data = getAttemptData();
  const now = Date.now();

  data.failedAttempts += 1;
  data.lastAttemptTime = now;

  if (data.failedAttempts >= MAX_ATTEMPTS) {
    data.lockoutUntil = now + LOCKOUT_DURATION_MS;
    setAttemptData(data);
    return { isLocked: true, remainingMs: LOCKOUT_DURATION_MS, attemptsLeft: 0 };
  }

  setAttemptData(data);
  return { isLocked: false, remainingMs: 0, attemptsLeft: MAX_ATTEMPTS - data.failedAttempts };
}

/**
 * Record a successful PIN attempt (resets the counter)
 */
export function recordSuccessfulAttempt(): void {
  setAttemptData({ failedAttempts: 0, lockoutUntil: null, lastAttemptTime: 0 });
}

/**
 * Get remaining attempts before lockout
 */
export function getRemainingAttempts(): number {
  const data = getAttemptData();
  return Math.max(0, MAX_ATTEMPTS - data.failedAttempts);
}

/**
 * Check if there have been any failed attempts
 */
export function hasFailedAttempts(): boolean {
  const data = getAttemptData();
  return data.failedAttempts > 0;
}

/**
 * Clear all attempt tracking data (used on logout)
 */
export function clearAttemptTracker(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Format remaining lockout time for display
 */
export function formatLockoutTime(ms: number): string {
  const minutes = Math.ceil(ms / 60000);
  if (minutes === 1) return '1 minute';
  return `${minutes} minutes`;
}
