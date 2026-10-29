import { isArray, isRecord } from '@/utils/guards';
import type { TypedDataPayload } from '@/utils/signing';

const UNSAFE_VISUAL_CONTROL_PATTERN =
  /[\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu;

export function chainNumber(value: unknown): bigint | undefined {
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'bigint'
  ) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

export function escapeVisualControls(value: string): string {
  return value.replace(
    UNSAFE_VISUAL_CONTROL_PATTERN,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function normalizeForReview(value: unknown): unknown {
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (isArray(value)) return value.map(normalizeForReview);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeForReview(entry)]),
    );
  }
  return value;
}

export function canonicalTypedDataReview(payload: TypedDataPayload): string {
  return escapeVisualControls(
    JSON.stringify(normalizeForReview(payload), null, 2),
  );
}
