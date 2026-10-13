/** @jest-environment jsdom */

import { profileStorageKey } from '@/config/runtimeProfile';
import {
  checkLockout,
  clearAttemptTracker,
  getRemainingAttempts,
  hasFailedAttempts,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from '../pinAttemptTracker';

const STORAGE_KEY = profileStorageKey('pin_attempt_tracker');
const NOW = Date.UTC(2026, 0, 1);
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const DEFAULT_DATA = { failedAttempts: 0, lockoutUntil: null, lastAttemptTime: 0 };

describe('PIN attempt tracker', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    localStorage.clear();
  });

  it.each([
    ['null', 'null'],
    ['an empty object', '{}'],
    ['an array', '[]'],
    ['a JSON string', '"corrupt"'],
    ['a JSON number', '5'],
    ['a JSON boolean', 'true'],
    ['a non-JSON string', 'corrupt'],
    ['an empty string', ''],
    ['a negative count', '{"failedAttempts":-1,"lockoutUntil":null,"lastAttemptTime":0}'],
    ['a fractional count', '{"failedAttempts":1.5,"lockoutUntil":null,"lastAttemptTime":0}'],
    ['a string count', '{"failedAttempts":"2","lockoutUntil":null,"lastAttemptTime":0}'],
    ['a nonnumeric count', '{"failedAttempts":"NaN","lockoutUntil":null,"lastAttemptTime":0}'],
    ['a null count', '{"failedAttempts":null,"lockoutUntil":null,"lastAttemptTime":0}'],
    ['a boolean count', '{"failedAttempts":true,"lockoutUntil":null,"lastAttemptTime":0}'],
    ['an object count', '{"failedAttempts":{},"lockoutUntil":null,"lastAttemptTime":0}'],
    ['an overflowing count', '{"failedAttempts":1e400,"lockoutUntil":null,"lastAttemptTime":0}'],
    ['a NaN literal', '{"failedAttempts":NaN,"lockoutUntil":null,"lastAttemptTime":0}'],
    ['an Infinity literal', '{"failedAttempts":Infinity,"lockoutUntil":null,"lastAttemptTime":0}'],
    ['a missing lockout', '{"failedAttempts":2,"lastAttemptTime":0}'],
    ['a string lockout', '{"failedAttempts":2,"lockoutUntil":"123","lastAttemptTime":0}'],
    ['a boolean lockout', '{"failedAttempts":2,"lockoutUntil":true,"lastAttemptTime":0}'],
    ['an overflowing lockout', '{"failedAttempts":2,"lockoutUntil":1e400,"lastAttemptTime":0}'],
    ['a missing timestamp', '{"failedAttempts":2,"lockoutUntil":null}'],
    ['a negative timestamp', '{"failedAttempts":2,"lockoutUntil":null,"lastAttemptTime":-1}'],
    ['a string timestamp', '{"failedAttempts":2,"lockoutUntil":null,"lastAttemptTime":"123"}'],
    ['a null timestamp', '{"failedAttempts":2,"lockoutUntil":null,"lastAttemptTime":null}'],
    [
      'an overflowing timestamp',
      '{"failedAttempts":2,"lockoutUntil":null,"lastAttemptTime":1e400}',
    ],
  ])('resets %s to the cleared-tracker state', (_label, stored) => {
    localStorage.setItem(STORAGE_KEY, stored);

    expect(checkLockout()).toEqual({ isLocked: false, remainingMs: 0 });
    expect(getRemainingAttempts()).toBe(5);
    expect(hasFailedAttempts()).toBe(false);
    expect(recordFailedAttempt()).toEqual({ isLocked: false, remainingMs: 0, attemptsLeft: 4 });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ failedAttempts: 1, lockoutUntil: null, lastAttemptTime: NOW })
    );
  });

  it('starts with five attempts when storage is empty', () => {
    expect(checkLockout()).toEqual({ isLocked: false, remainingMs: 0 });
    expect(getRemainingAttempts()).toBe(5);
    expect(hasFailedAttempts()).toBe(false);
  });

  it.each([6, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE])('clamps a huge count (%s)', (count) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ failedAttempts: count, lockoutUntil: null, lastAttemptTime: NOW })
    );

    expect(getRemainingAttempts()).toBe(0);
    expect(hasFailedAttempts()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ failedAttempts: 5, lockoutUntil: null, lastAttemptTime: NOW })
    );
    expect(recordFailedAttempt()).toEqual({
      isLocked: true,
      remainingMs: LOCKOUT_DURATION_MS,
      attemptsLeft: 0,
    });
  });

  it('caps a far-future lockout once and lets the corrected deadline expire', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ failedAttempts: 5, lockoutUntil: Number.MAX_VALUE, lastAttemptTime: NOW })
    );

    expect(checkLockout()).toEqual({ isLocked: true, remainingMs: LOCKOUT_DURATION_MS });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        failedAttempts: 5,
        lockoutUntil: NOW + LOCKOUT_DURATION_MS,
        lastAttemptTime: NOW,
      })
    );
    jest.setSystemTime(NOW + 60_000);
    expect(checkLockout()).toEqual({ isLocked: true, remainingMs: LOCKOUT_DURATION_MS - 60_000 });
    jest.setSystemTime(NOW + LOCKOUT_DURATION_MS);
    expect(checkLockout()).toEqual({ isLocked: false, remainingMs: 0 });
    expect(getRemainingAttempts()).toBe(5);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(DEFAULT_DATA));
  });

  it('keeps a capped lockout when persisting the correction fails', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ failedAttempts: 7, lockoutUntil: Number.MAX_VALUE, lastAttemptTime: NOW })
    );
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    try {
      expect(checkLockout()).toEqual({ isLocked: true, remainingMs: LOCKOUT_DURATION_MS });
      expect(getRemainingAttempts()).toBe(0);
    } finally {
      setItem.mockRestore();
    }
  });

  it.each([60_000, LOCKOUT_DURATION_MS])(
    'preserves an in-range lockout of %s ms',
    (remainingMs) => {
      const stored = JSON.stringify({
        failedAttempts: 5,
        lockoutUntil: NOW + remainingMs,
        lastAttemptTime: NOW,
      });
      localStorage.setItem(STORAGE_KEY, stored);

      expect(checkLockout()).toEqual({ isLocked: true, remainingMs });
      expect(getRemainingAttempts()).toBe(0);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(stored);
    }
  );

  it('locks on the fifth failure and resets when the lockout expires', () => {
    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect(recordFailedAttempt()).toEqual({
        isLocked: false,
        remainingMs: 0,
        attemptsLeft: 5 - attempt,
      });
      expect(getRemainingAttempts()).toBe(5 - attempt);
      expect(hasFailedAttempts()).toBe(true);
    }
    expect(recordFailedAttempt()).toEqual({
      isLocked: true,
      remainingMs: LOCKOUT_DURATION_MS,
      attemptsLeft: 0,
    });
    expect(getRemainingAttempts()).toBe(0);
    jest.setSystemTime(NOW + LOCKOUT_DURATION_MS - 1);
    expect(checkLockout()).toEqual({ isLocked: true, remainingMs: 1 });
    jest.setSystemTime(NOW + LOCKOUT_DURATION_MS);
    expect(checkLockout()).toEqual({ isLocked: false, remainingMs: 0 });
    expect(getRemainingAttempts()).toBe(5);
    expect(hasFailedAttempts()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(DEFAULT_DATA));
    expect(recordFailedAttempt()).toEqual({ isLocked: false, remainingMs: 0, attemptsLeft: 4 });
  });

  it.each([1, 5])('clears the count and lockout after success following %s failures', (count) => {
    for (let attempt = 0; attempt < count; attempt += 1) recordFailedAttempt();

    recordSuccessfulAttempt();

    expect(checkLockout()).toEqual({ isLocked: false, remainingMs: 0 });
    expect(getRemainingAttempts()).toBe(5);
    expect(hasFailedAttempts()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(DEFAULT_DATA));
  });

  it('clears the stored record on logout', () => {
    recordFailedAttempt();

    clearAttemptTracker();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(checkLockout()).toEqual({ isLocked: false, remainingMs: 0 });
    expect(getRemainingAttempts()).toBe(5);
    expect(hasFailedAttempts()).toBe(false);
  });
});
