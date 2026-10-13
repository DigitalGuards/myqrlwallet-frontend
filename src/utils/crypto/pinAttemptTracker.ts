/**
 * PIN Attempt Tracker
 *
 * Provides brute force protection for PIN entry by tracking failed attempts
 * and enforcing lockouts after too many failures.
 */

import { profileStorageKey } from '@/config/runtimeProfile';

const STORAGE_KEY = profileStorageKey('pin_attempt_tracker');
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
// A stored deadline further ahead than one lockout plus this margin cannot come
// from recordFailedAttempt, even after the clock stepped back; it is corrupt.
const CLOCK_STEP_TOLERANCE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface AttemptData {
  failedAttempts: number;
  lockoutUntil: number | null;
  lastAttemptTime: number;
}

function isAttemptData(value: unknown): value is AttemptData {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'failedAttempts' in value &&
    typeof value.failedAttempts === 'number' &&
    Number.isFinite(value.failedAttempts) &&
    Number.isInteger(value.failedAttempts) &&
    value.failedAttempts >= 0 &&
    'lockoutUntil' in value &&
    (value.lockoutUntil === null ||
      (typeof value.lockoutUntil === 'number' && Number.isFinite(value.lockoutUntil))) &&
    'lastAttemptTime' in value &&
    typeof value.lastAttemptTime === 'number' &&
    Number.isFinite(value.lastAttemptTime) &&
    value.lastAttemptTime >= 0
  );
}

function getAttemptData(): AttemptData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (isAttemptData(parsed)) {
        const now = Date.now();
        const corruptDeadline =
          parsed.lockoutUntil !== null &&
          parsed.lockoutUntil > now + LOCKOUT_DURATION_MS + CLOCK_STEP_TOLERANCE_MS;
        const data: AttemptData = {
          failedAttempts: Math.min(parsed.failedAttempts, MAX_ATTEMPTS),
          // A plausible deadline stays as stored, so a clock that stepped back
          // does not shorten a real lockout.
          lockoutUntil: corruptDeadline ? now + LOCKOUT_DURATION_MS : parsed.lockoutUntil,
          lastAttemptTime: parsed.lastAttemptTime,
        };
        if (
          data.failedAttempts !== parsed.failedAttempts ||
          data.lockoutUntil !== parsed.lockoutUntil
        ) {
          // Persist the capped deadline so subsequent reads allow the lockout to expire.
          // A failed write keeps the validated record for this read.
          try {
            setAttemptData(data);
          } catch {
            // Storage full or unavailable.
          }
        }
        return data;
      }
    }
  } catch {
    // Treat unreadable storage as a cleared tracker.
  }
  // This reset matches clearAttemptTracker(); storage writers can already remove this key.
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
