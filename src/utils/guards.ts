/**
 * Runtime type guards for untrusted input (relay messages, postMessage, dApp
 * requests, storage reads, JSON.parse results). The hardening mandate bans type
 * assertions, so every wire value enters the typed world through a predicate.
 */

import { Children, isValidElement, type ReactNode } from 'react';

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

/** Keep list checks at the operation that requires an array. */
export function arrayValue(value: unknown): unknown[] {
  if (!isArray(value)) throw new TypeError('Expected an array');
  return value;
}

/** JSON arrays and strings both support the original iteration operations. */
export function iterableValue(value: unknown): Iterable<unknown> {
  if (typeof value === 'string') return value;
  return arrayValue(value);
}

/** Property reads box primitives and fail on nullish receivers. */
export function propertyValue(value: unknown, key: string): unknown {
  if (value == null) throw new TypeError('Cannot read properties of null or undefined');
  const receiver: unknown = Object(value);
  if (!isObject(receiver)) throw new TypeError('Invalid property receiver');
  return receiver[key];
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function stringValue(value: unknown): string {
  if (!isString(value)) throw new TypeError('Expected a string');
  return value;
}

/** HTML string attributes omit nullish values, booleans, symbols and functions. */
export function stringAttribute(value: unknown): string | undefined {
  if (value == null || typeof value === 'boolean' || typeof value === 'symbol' || typeof value === 'function') {
    return undefined;
  }
  return toTemplateString(value);
}

/** Preserve addition for a retry count read from JSON, including string concatenation. */
export function incrementStoredNumber(value: unknown): string | number {
  const primitive = isRecord(value) || isArray(value) ? toTemplateString(value) : value;
  return typeof primitive === 'string' ? primitive + '1' : toNumber(primitive) + 1;
}

function isReactNode(value: unknown): value is ReactNode {
  return value == null || typeof value === 'string' || typeof value === 'number' ||
    typeof value === 'bigint' || typeof value === 'boolean' || isValidElement(value) ||
    (isArray(value) && value.every(isReactNode));
}

/** Keep stored metadata intact and let unsupported children fail at rendering. */
export function renderValue(value: unknown): ReactNode {
  if (isReactNode(value)) return value;
  const children: unknown = Reflect.apply(Children.toArray.bind(Children), Children, [value]);
  if (!isReactNode(children)) throw new TypeError('Invalid React children');
  return children;
}

/** ABI integers accept the original string, number or bigint without conversion. */
export function integerArgument(value: unknown): string | number | bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new TypeError('Invalid integer argument');
  }
  return value;
}

/** Native ToNumber coercion also rejects bigint, including boxed values. */
export function toNumber(value: unknown): number {
  const result: unknown = Reflect.apply(Math.min, undefined, [value]);
  if (typeof result !== 'number') throw new TypeError('Number conversion failed');
  return result;
}

// JSON.stringify returns undefined for top-level undefined, symbols, functions
// and objects whose toJSON returns one of those values.
function stringifyUnknown(value: unknown): string | undefined {
  return JSON.stringify(value);
}

/** Read string diagnostics across realms while keeping tagged plain objects on the JSON path. */
function foreignErrorDetails(value: unknown): { name: string; message: string } | undefined {
  try {
    if (!isObject(value)) return undefined;
    if (Symbol.toStringTag in value) {
      // DOMException's prototype getter validates its receiver across realms.
      if (typeof DOMException === 'undefined') return undefined;
      const code: unknown = Reflect.get(DOMException.prototype, 'code', value);
      if (typeof code !== 'number') return undefined;
    } else if (Object.prototype.toString.call(value) !== '[object Error]') {
      return undefined;
    }
    const message = value['message'];
    if (typeof message !== 'string') return undefined;
    const name = value['name'];
    return { name: typeof name === 'string' ? name : 'Error', message };
  } catch {
    // Unreadable brands or diagnostics retain the existing serialization fallback.
    return undefined;
  }
}

/** Return a local Error so callers can discriminate failures with instanceof. */
export function toError(value: unknown): Error {
  try {
    // Prototype inspection can throw for proxies, just like serialization.
    if (value instanceof Error) return value;
    if (typeof value === 'string') return new Error(value);
    const details = foreignErrorDetails(value);
    if (details) {
      const error = new Error(details.message);
      error.name = details.name;
      return error;
    }
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
    const details = foreignErrorDetails(value);
    if (details) return details.message;
    return stringifyUnknown(value) ?? '';
  } catch {
    return '[object]';
  }
}
