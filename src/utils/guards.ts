/**
 * Runtime type guards for untrusted input (relay messages, postMessage, dApp
 * requests, storage reads, JSON.parse results). The hardening mandate bans type
 * assertions, so every wire value enters the typed world through a predicate.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Array.isArray narrows unknown to any[], which silently re-launders every
 * element; this predicate keeps the elements unknown.
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Coerce an unknown caught value into an Error without losing the message. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(JSON.stringify(value) ?? 'Unknown error');
  } catch {
    return new Error('Unknown error');
  }
}

/** typeof === 'function' narrows to the bare Function type; this keeps calls typed as unknown-returning. */
export function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

/**
 * Render an unknown thrown or rejected value as text without the
 * "[object Object]" default stringification. Used where the text only feeds a
 * pattern match or a log line.
 */
export function describeUnknown(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  ) {
    return value.toString();
  }
  if (typeof value === 'function') return '[function]';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '[object]';
  }
}
