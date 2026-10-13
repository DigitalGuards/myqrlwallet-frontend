import type { CryptoOperationError } from "./cryptoWorkerClient";
import type { PinDecryptionError } from "./walletEncryption";
import {
  checkLockout,
  formatLockoutTime,
  getRemainingAttempts,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from "./pinAttemptTracker";

interface PinAttemptStatus {
  isLocked: boolean;
  remainingMs: number;
  attemptsLeft: number;
}

export class PinVerificationError extends Error implements PinAttemptStatus {
  readonly isLocked: boolean;
  readonly remainingMs: number;
  readonly attemptsLeft: number;

  constructor(status: PinAttemptStatus, message?: string) {
    super(
      message ??
        (status.isLocked
          ? `Too many failed attempts. Please wait ${formatLockoutTime(status.remainingMs)}.`
          : `Incorrect PIN. ${status.attemptsLeft} attempt${status.attemptsLeft === 1 ? "" : "s"} remaining.`),
    );
    this.name = "PinVerificationError";
    this.isLocked = status.isLocked;
    this.remainingMs = status.remainingMs;
    this.attemptsLeft = status.attemptsLeft;
  }
}

export function isIncorrectPinError(
  error: unknown,
): error is PinDecryptionError | CryptoOperationError {
  return (
    error instanceof Error &&
    (("code" in error && error.code === "INCORRECT_PIN") ||
      (error.name === "PinDecryptionError" &&
        "incorrectPin" in error &&
        error.incorrectPin === true))
  );
}

let verificationPending = false;

/** Limit PIN authentication. Keep encryption, signing and RPC work outside this callback. */
export async function verifyPinWithLimit<T>(
  decrypt: () => Promise<T>,
): Promise<T> {
  const lockout = checkLockout();
  if (lockout.isLocked) {
    throw new PinVerificationError({ ...lockout, attemptsLeft: 0 });
  }

  // Reject overlapping submissions before they start crypto work. Waiting
  // here can deadlock callers that already hold the native wallet queue.
  if (verificationPending) {
    // A PinVerificationError, so every prompt keeps its request open for a
    // retry. No attempt is counted.
    throw new PinVerificationError(
      { isLocked: false, remainingMs: 0, attemptsLeft: getRemainingAttempts() },
      "Another PIN check is still running. Please try again.",
    );
  }
  verificationPending = true;
  try {
    let value: T;
    try {
      value = await decrypt();
    } catch (error) {
      if (!isIncorrectPinError(error)) throw error;
      const current = checkLockout();
      throw new PinVerificationError(
        current.isLocked
          ? { ...current, attemptsLeft: 0 }
          : recordFailedAttempt(),
      );
    }
    // Preserve a lockout started by another wallet document during decryption.
    const current = checkLockout();
    if (current.isLocked) {
      throw new PinVerificationError({ ...current, attemptsLeft: 0 });
    }
    recordSuccessfulAttempt();
    return value;
  } finally {
    verificationPending = false;
  }
}
