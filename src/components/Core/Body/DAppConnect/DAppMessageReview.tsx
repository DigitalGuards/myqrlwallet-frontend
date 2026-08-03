/**
 * Approval preview for `qrl_signMessage`.
 *
 * Decodes the 0x-hex message bytes for a human-readable view when they
 * parse as printable UTF-8; falls back to raw hex + byte-length when they
 * don't (binary payloads). The 64-byte digest stays behind an "Advanced"
 * disclosure since most users don't need it.
 */

import { useState } from 'react';
import { hexToBytes } from '@/utils/signing';

interface DAppMessageReviewProps {
  messageHex: string;
  digestHex?: string;
}

const UNSAFE_VISUAL_CONTROL_PATTERN =
  /[\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/u;

export function tryDecodeUtf8(
  hex: string,
):
  | { ok: true; text: string }
  | {
      ok: false;
      reason: 'not-hex' | 'non-utf8' | 'control-chars' | 'format-controls';
    } {
  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(hex);
  } catch {
    return { ok: false, reason: 'not-hex' };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (UNSAFE_VISUAL_CONTROL_PATTERN.test(text)) {
      return { ok: false, reason: 'format-controls' };
    }
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (
        c <= 0x08 ||
        (c >= 0x0e && c <= 0x1f) ||
        (c >= 0x7f && c <= 0x9f)
      ) {
        return { ok: false, reason: 'control-chars' };
      }
    }
    return { ok: true, text };
  } catch {
    return { ok: false, reason: 'non-utf8' };
  }
}

const DAppMessageReview: React.FC<DAppMessageReviewProps> = ({ messageHex, digestHex }) => {
  const [showDigest, setShowDigest] = useState(false);
  const decoded = tryDecodeUtf8(messageHex);
  const byteLength = messageHex.startsWith('0x') ? (messageHex.length - 2) / 2 : 0;

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4 text-sm">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Message</span>
        <span className="text-muted-foreground">
          {byteLength} byte{byteLength === 1 ? '' : 's'}
        </span>
      </div>
      {decoded.ok ? (
        <>
          <p
            className="max-h-32 overflow-auto break-words font-mono text-sm"
            dir="ltr"
          >
            {decoded.text}
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Raw signed bytes
            </summary>
            <p className="mt-2 max-h-32 overflow-auto break-all font-mono" dir="ltr">
              {messageHex}
            </p>
          </details>
        </>
      ) : (
        <div>
          <p className="text-xs text-muted-foreground italic">
            Not a safely printable UTF-8 string, showing raw hex.
          </p>
          <p
            className="mt-1 max-h-32 overflow-auto break-all font-mono text-xs"
            dir="ltr"
          >
            {messageHex}
          </p>
        </div>
      )}
      {digestHex && (
        <details
          className="text-xs"
          open={showDigest}
          onToggle={(e) => setShowDigest((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Advanced: 64-byte SHAKE256 digest
          </summary>
          <p className="mt-2 break-all font-mono" dir="ltr">{digestHex}</p>
        </details>
      )}
    </div>
  );
};

export default DAppMessageReview;
