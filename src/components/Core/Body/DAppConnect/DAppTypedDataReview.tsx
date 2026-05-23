/**
 * Approval preview for `qrl_signTypedData`.
 *
 * Shows the domain identity (name, plus chainId / verifyingContract when
 * present), the primary type, and a labeled row per message field. Nested
 * structs and arrays expand one level inline; deeper trees collapse to
 * `[N items]` to keep the modal scannable. 64-byte digest behind an
 * "Advanced" disclosure.
 */

import { useState } from 'react';
import type { TypedDataPayload } from '@/utils/signing';

interface DAppTypedDataReviewProps {
  payload: TypedDataPayload;
  digestHex?: string;
}

function renderValue(value: unknown, depth: number): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">(empty)</span>;
  if (typeof value === 'string') {
    return <span className="font-mono text-xs break-all">{value}</span>;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return <span className="font-mono text-xs">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (depth >= 1) {
      return <span className="text-muted-foreground italic">[{value.length} item{value.length === 1 ? '' : 's'}]</span>;
    }
    return (
      <ul className="space-y-1">
        {value.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-muted-foreground">[{i}]</span>
            {renderValue(item, depth + 1)}
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    if (depth >= 1) {
      return <span className="text-muted-foreground italic">{`{${Object.keys(value).length} fields}`}</span>;
    }
    return (
      <div className="mt-1 space-y-1 border-l border-border pl-2">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{k}</span>
            <span className="text-right">{renderValue(v, depth + 1)}</span>
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-muted-foreground">{String(value)}</span>;
}

const DAppTypedDataReview: React.FC<DAppTypedDataReviewProps> = ({ payload, digestHex }) => {
  const [showDigest, setShowDigest] = useState(false);
  const { domain, primaryType, message } = payload;
  const name = typeof domain.name === 'string' ? domain.name : '(unnamed)';
  const chainId = typeof domain.chainId === 'string' || typeof domain.chainId === 'number'
    ? String(domain.chainId)
    : undefined;
  const verifyingContract = typeof domain.verifyingContract === 'string'
    ? domain.verifyingContract
    : undefined;

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4 text-sm">
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Domain</span>
          <span className="font-medium">{name}</span>
        </div>
        {chainId && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Chain ID</span>
            <span className="font-mono">{chainId}</span>
          </div>
        )}
        {verifyingContract && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Contract</span>
            <span className="font-mono break-all max-w-[200px] text-right">{verifyingContract}</span>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <div className="text-xs text-muted-foreground">Primary type</div>
        <div className="font-medium">{primaryType}</div>
      </div>

      <div className="border-t border-border pt-3 space-y-1">
        <div className="text-xs text-muted-foreground mb-2">Message</div>
        {Object.entries(message).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{k}</span>
            <span className="text-right">{renderValue(v, 0)}</span>
          </div>
        ))}
      </div>

      <p className="border-t border-border pt-3 text-xs text-amber-600 dark:text-amber-400">
        Only sign data from sites you trust. A signed challenge can be used to authenticate as you.
      </p>

      {digestHex && (
        <details
          className="text-xs"
          open={showDigest}
          onToggle={(e) => setShowDigest((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Advanced: 64-byte SHAKE256 digest
          </summary>
          <p className="mt-2 break-all font-mono">{digestHex}</p>
        </details>
      )}
    </div>
  );
};

export default DAppTypedDataReview;
