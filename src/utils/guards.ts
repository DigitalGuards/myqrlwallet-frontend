/**
 * Runtime type guards for untrusted input (relay messages, postMessage, dApp
 * requests, storage reads, JSON.parse results). The hardening mandate bans type
 * assertions, so every wire value enters the typed world through a predicate.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Object property reads also support arrays and boxed primitives. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Callable objects can carry runtime flags and message fields too. */
export function isObjectLike(value: unknown): value is Record<string, unknown> {
  return isObject(value) || typeof value === 'function';
}

/**
 * Array.isArray narrows unknown to any[], which silently re-launders every
 * element; this predicate keeps the elements unknown.
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

// JSON.stringify returns undefined for top-level undefined, symbols, functions
// and objects whose toJSON returns one of those values.
function stringifyUnknown(value: unknown): string | undefined {
  return JSON.stringify(value);
}

/** Return a local Error so callers can discriminate failures with instanceof. */
export function toError(value: unknown): Error {
  try {
    // Prototype inspection can throw for proxies, just like serialization.
    if (value instanceof Error) return value;
    if (typeof value === 'string') return new Error(value);
    return new Error(stringifyUnknown(value) ?? 'Unknown error');
  } catch {
    return new Error('Unknown error');
  }
}

/** typeof === 'function' narrows to the bare Function type; this keeps calls typed as unknown-returning. */
export function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

/** Preserve native numeric-hint coercion and errors for unknown RPC values. */
export function toBigInt(value: unknown): bigint {
  const result: unknown = Reflect.apply(BigInt, undefined, [value]);
  if (typeof result !== 'bigint') throw new TypeError('BigInt conversion failed');
  return result;
}

/** Template interpolation uses string-hint coercion and rejects symbols. */
export function toTemplateString(value: unknown): string {
  if (typeof value === 'symbol') {
    throw new TypeError('Cannot convert a Symbol value to a string');
  }
  return String(value);
}

/**
 * Render an unknown thrown or rejected value as text without the
 * "[object Object]" default stringification. Used where the text only feeds a
 * pattern match or a log line.
 */
export function describeUnknown(value: unknown): string {
  try {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (value instanceof Error) {
      const message: unknown = value.message;
      return typeof message === 'string' ? message : String(message);
    }
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint' ||
      typeof value === 'symbol'
    ) {
      return value.toString();
    }
    if (typeof value === 'function') return '[function]';
    return stringifyUnknown(value) ?? '';
  } catch {
    return '[object]';
  }
}
