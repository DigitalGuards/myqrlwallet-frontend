/**
 * Approval preview for `qrl_signTypedData`.
 *
 * Shows every signed domain/message value recursively. The validated encoder
 * budget bounds the tree, and a scrollable canonical disclosure exposes the
 * complete types/domain/message payload alongside the digest.
 */

import { useState } from 'react';
import { canonicalTypedDataReview, escapeVisualControls } from './typedDataReview';
import { isArray, isRecord } from '@/utils/guards';
import type { TypedDataPayload } from '@/utils/signing';

interface DAppTypedDataReviewProps {
  payload: TypedDataPayload;
  digestHex?: string;
  connectedChainId?: string;
}

function renderValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">(empty)</span>;
  if (typeof value === 'string') {
    return (
      <span className="font-mono text-xs break-all" dir="ltr">
        {escapeVisualControls(JSON.stringify(value))}
      </span>
    );
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return <span className="font-mono text-xs">{String(value)}</span>;
  }
  if (isArray(value)) {
    return (
      <ul className="space-y-1 border-l border-border pl-2">
        {value.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0 whitespace-nowrap text-muted-foreground">[{i}]</span>
            <span className="min-w-0">{renderValue(item)}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (isRecord(value)) {
    return (
      <div className="mt-1 space-y-1 border-l border-border pl-2">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
            <span className="text-muted-foreground">{k}</span>
            <span className="min-w-0 text-right">{renderValue(v)}</span>
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-muted-foreground">(unsupported value)</span>;
}

function chainNumber(value: unknown): bigint | undefined {
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

const DAppTypedDataReview: React.FC<DAppTypedDataReviewProps> = ({
  payload,
  digestHex,
  connectedChainId,
}) => {
  const [showDigest, setShowDigest] = useState(false);
  const { domain, primaryType, message } = payload;
  const domainFields = payload.types['QRLDomain'] ?? [];
  const messageFields = payload.types[primaryType] ?? [];
  const canonicalPayload = canonicalTypedDataReview(payload);
  const hasChainId = domainFields.some((field) => field.name === 'chainId');
  const domainChain = hasChainId ? chainNumber(domain['chainId']) : undefined;
  const connectedChain = chainNumber(connectedChainId);
  const chainMismatch = domainChain !== undefined &&
    connectedChain !== undefined && domainChain !== connectedChain;

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4 text-sm [overflow-wrap:anywhere]">
      <div className="space-y-1">
        <div data-review-block className="mb-2 text-xs text-muted-foreground">Signed domain</div>
        {domainFields.map((field) => (
          <div
            key={field.name}
            data-review-block data-review-value={field.type}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2 text-xs"
          >
            <span className="text-muted-foreground">{field.name}</span>
            <span className="min-w-0 text-right">{renderValue(domain[field.name])}</span>
          </div>
        ))}
        {chainMismatch && (
          <p data-review-block role="alert" className="pt-2 text-xs text-amber-600 dark:text-amber-400">
            The signed domain chain ID ({domainChain.toString()}) differs from the
            connected chain ({connectedChain.toString()}). Only sign if you expect
            this chain.
          </p>
        )}
        {!hasChainId && (
          <p data-review-block className="pt-2 text-xs text-amber-600 dark:text-amber-400">
            This domain has no chain ID. The signature is not bound to a chain.
          </p>
        )}
      </div>

      <div data-review-block className="border-t border-border pt-3">
        <div className="text-xs text-muted-foreground">Primary type</div>
        <div className="font-medium">{primaryType}</div>
      </div>

      <div className="border-t border-border pt-3 space-y-1">
        <div data-review-block className="text-xs text-muted-foreground mb-2">Message</div>
        {messageFields.map((field) => (
          <div
            key={field.name}
            data-review-block data-review-value={field.type}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2"
          >
            <span className="text-muted-foreground">{field.name}</span>
            <span className="min-w-0 text-right">{renderValue(message[field.name])}</span>
          </div>
        ))}
      </div>

      <details className="border-t border-border pt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Full signed payload (canonical JSON)
        </summary>
        <pre
          className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono"
          dir="ltr"
        >
          {canonicalPayload}
        </pre>
      </details>

      <p data-review-block className="border-t border-border pt-3 text-xs text-amber-600 dark:text-amber-400">
        Only sign data from sites you trust. A signed challenge can be used to authenticate as you.
      </p>

      {digestHex && (
        <details
          className="text-xs"
          open={showDigest}
          onToggle={(e) => {
            const details = e.currentTarget;
            if (details instanceof HTMLDetailsElement) setShowDigest(details.open);
          }}
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

export default DAppTypedDataReview;
