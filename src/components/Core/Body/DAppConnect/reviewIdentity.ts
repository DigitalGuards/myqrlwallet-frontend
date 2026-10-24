import { isArray, isRecord } from '@/utils/guards';

const generations = new WeakMap<object, number>();
let sequence = 0;

/** Request identity is independent of all dApp-controlled IDs and values. */
export function reviewGeneration(request: object): number {
  const existing = generations.get(request);
  if (existing !== undefined) return existing;
  if (sequence === Number.MAX_SAFE_INTEGER) throw new Error('Review generation exhausted');
  const generation = ++sequence;
  generations.set(request, generation);
  return generation;
}

/**
 * Injective encoding of JSON review values plus bigint and undefined. Every
 * node has a type tag; JSON preserves string and collection boundaries. Object
 * entries preserve their display order, including absent versus present keys.
 * Unsupported values fail closed. Never use this encoding as request identity.
 */
export function reviewValueKey(value: unknown): string {
  function encode(entry: unknown): unknown {
    if (entry === null) return ['null'];
    switch (typeof entry) {
      case 'undefined': return ['undefined'];
      case 'string': return ['string', entry];
      case 'boolean': return ['boolean', entry];
      case 'number': return ['number', Object.is(entry, -0) ? '-0' : String(entry)];
      case 'bigint': return ['bigint', entry.toString()];
    }
    if (isArray(entry)) {
      return ['array', Array.from({ length: entry.length }, (_, index) =>
        Object.prototype.hasOwnProperty.call(entry, index) ? encode(entry[index]) : ['hole'])];
    }
    if (isRecord(entry)) {
      const prototype: unknown = Object.getPrototypeOf(entry);
      if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(entry).length)
        throw new Error('Unsupported review object');
      return ['object', Object.entries(entry).map(([key, item]) => [key, encode(item)])];
    }
    throw new Error('Unsupported review value');
  }
  return JSON.stringify(encode(value));
}
