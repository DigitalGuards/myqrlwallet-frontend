import type { TokenInterface } from "@/constants/tokens";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
/**
 * Approval preview for `qrl_signTypedData`.
 *
 * Shows every signed domain/message value recursively. The validated encoder
 * budget bounds the tree, and a scrollable canonical disclosure exposes the
 * complete types/domain/message payload alongside the digest.
 */

import { useState } from 'react';
import DAppVaultReview from './DAppVaultReview';
import { recognizeVaultRequest } from '@/utils/signing/quantaVault';
import { canonicalTypedDataReview, chainNumber, escapeVisualControls } from './typedDataReview';
import { isArray, isRecord } from '@/utils/guards';
import { reviewValueKey } from './reviewIdentity';
import type { TypedDataPayload } from '@/utils/signing';

interface DAppTypedDataReviewProps {
  payload: TypedDataPayload;
  digestHex?: string;
  connectedChainId?: string;
  origin?: string;
  knownTokens?: readonly TokenInterface[];
}

function renderValue(value: unknown, path: string, t: TFunction<["dapps", "common", "settings", "transfer"]>, depth = 0): React.ReactNode {
  // Full paths identify descendants once indentation reaches its width cap.
  const indent = depth < 2 ? 'border-l border-border pl-2' : '';
  if (value === null || value === undefined) return <span className="text-muted-foreground">{t("dapps:empty")}</span>;
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
      <ul className={`space-y-1 ${indent}`}>
        {value.map((item, i) => {
          const itemPath = `${path}[${i}]`;
          return (
            <li key={i} className={depth < 2 ? 'flex gap-2' : 'review-tree-entry'}>
              <span className={depth < 2 ? 'shrink-0 whitespace-nowrap text-muted-foreground' : 'text-muted-foreground'}>
                {depth < 2 ? `[${i}]` : itemPath}
              </span>
              <span className="min-w-0">{renderValue(item, itemPath, t, depth + 1)}</span>
            </li>
          );
        })}
      </ul>
    );
  }
  if (isRecord(value)) {
    return (
      <div className={`mt-1 space-y-1 ${indent}`}>
        {Object.entries(value).map(([k, v]) => {
          const fieldPath = `${path}.${k}`;
          return (
            <div key={k} className={depth < 2 ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2' : 'review-tree-entry'}>
              <span className="text-muted-foreground">{depth < 2 ? k : fieldPath}</span>
              <span className="min-w-0 text-right">{renderValue(v, fieldPath, t, depth + 1)}</span>
            </div>
          );
        })}
      </div>
    );
  }
  return <span className="text-muted-foreground">{t("dapps:unsupportedValue")}</span>;
}

const DAppTypedDataReview: React.FC<DAppTypedDataReviewProps> = ({
  payload,
  digestHex,
  connectedChainId,
  origin,
  knownTokens,
}) => {
  const { t } = useTranslation(["dapps", "common", "settings", "transfer"]);
  const [showDigest, setShowDigest] = useState(false);
  const { domain, primaryType, message } = payload;
  const vaultRequest = recognizeVaultRequest(payload);
  const domainFields = payload.types['QRLDomain'] ?? [];
  const messageFields = payload.types[primaryType] ?? [];
  const canonicalPayload = canonicalTypedDataReview(payload);
  const hasChainId = domainFields.some((field) => field.name === 'chainId');
  const domainChain = hasChainId ? chainNumber(domain['chainId']) : undefined;
  const connectedChain = chainNumber(connectedChainId);
  const chainMismatch = domainChain !== undefined &&
    connectedChain !== undefined && domainChain !== connectedChain;

  return (
    <div className="review-typed-data space-y-3 rounded-md border border-border bg-muted/30 p-4 text-sm [overflow-wrap:anywhere]">
      {vaultRequest ? (
        <DAppVaultReview
          request={vaultRequest}
          connectedChainId={connectedChainId}
          origin={origin}
          knownTokens={knownTokens}
        />
      ) : (
        <>
          {domain["name"] === "QuantaVault" && (
            <p
              data-review-block
              role="alert"
              className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm font-semibold text-amber-600 dark:text-amber-400"
            >
              {t("dapps:vaultSchemaWarning")}
            </p>
          )}
          <div className="space-y-1">
            <div data-review-block className="mb-2 text-xs text-muted-foreground">{t("dapps:signedDomain")}</div>
            {domainFields.map((field) => (
              <div
                key={field.name}
                data-review-block data-review-value={reviewValueKey([field, payload.types, domain[field.name]])}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2 text-xs"
              >
                <span className="text-muted-foreground">{field.name}</span>
                <span className="min-w-0 text-right">{renderValue(domain[field.name], field.name, t)}</span>
              </div>
            ))}
            {chainMismatch && (
              <p data-review-block role="alert" className="pt-2 text-xs text-amber-600 dark:text-amber-400">
                {t("dapps:chainMismatch", { domain: domainChain.toString(), connected: connectedChain.toString() })}
              </p>
            )}
            {!hasChainId && (
              <p data-review-block className="pt-2 text-xs text-amber-600 dark:text-amber-400">{t("dapps:noChain")}</p>
            )}
          </div>

          <div data-review-block className="border-t border-border pt-3">
            <div className="text-xs text-muted-foreground">{t("dapps:primaryType")}</div>
            <div className="font-medium">{primaryType}</div>
          </div>

          <div className="border-t border-border pt-3 space-y-1">
            <div data-review-block className="text-xs text-muted-foreground mb-2">{t("dapps:message")}</div>
            {messageFields.map((field) => (
              <div
                key={field.name}
                data-review-block data-review-value={reviewValueKey([field, payload.types, message[field.name]])}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2"
              >
                <span className="text-muted-foreground">{field.name}</span>
                <span className="min-w-0 text-right">{renderValue(message[field.name], field.name, t)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <details className="border-t border-border pt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t("dapps:fullPayload")}</summary>
        <pre
          className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono"
          dir="ltr"
        >
          {canonicalPayload}
        </pre>
      </details>

      <p data-review-block className="border-t border-border pt-3 text-xs text-amber-600 dark:text-amber-400">{t("dapps:trustWarning")}</p>

      {digestHex && (
        <details
          className="text-xs"
          open={showDigest}
          onToggle={(e) => {
            const details = e.currentTarget;
            if (details instanceof HTMLDetailsElement) setShowDigest(details.open);
          }}
        >
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t("dapps:digest")}</summary>
          <p className="mt-2 break-all font-mono" dir="ltr">{digestHex}</p>
        </details>
      )}
    </div>
  );
};

export default DAppTypedDataReview;
