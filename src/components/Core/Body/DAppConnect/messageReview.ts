import { hexToBytes } from '@/utils/signing';

const UNSAFE_VISUAL_CONTROL_PATTERN =
  /[\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/u;

export function tryDecodeUtf8(hex: string):
  | { ok: true; text: string }
  | {
      ok: false;
      reason: 'not-hex' | 'non-utf8' | 'control-chars' | 'format-controls' | 'invisible-chars';
    } {
  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(hex);
  } catch {
    return { ok: false, reason: 'not-hex' };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text && /^[\s\p{Default_Ignorable_Code_Point}]+$/u.test(text)) {
      return { ok: false, reason: 'invisible-chars' };
    }
    if (UNSAFE_VISUAL_CONTROL_PATTERN.test(text)) {
      return { ok: false, reason: 'format-controls' };
    }
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c <= 0x08 || (c >= 0x0e && c <= 0x1f) || (c >= 0x7f && c <= 0x9f)) {
        return { ok: false, reason: 'control-chars' };
      }
    }
    return { ok: true, text };
  } catch {
    return { ok: false, reason: 'non-utf8' };
  }
}
