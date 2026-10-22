import { useTranslation } from "react-i18next";
/**
 * Approval preview for `qrl_signMessage`.
 *
 * Decodes the 0x-hex message bytes for a human-readable view when they
 * parse as printable UTF-8; falls back to raw hex + byte-length when they
 * don't (binary payloads). The 64-byte digest stays behind an "Advanced"
 * disclosure since most users don't need it.
 */

import { useState } from "react";
import { tryDecodeUtf8 } from "./messageReview";

interface DAppMessageReviewProps {
  messageHex: string;
  digestHex?: string;
}

const DAppMessageReview: React.FC<DAppMessageReviewProps> = ({
  messageHex,
  digestHex,
}) => {
  const { t } = useTranslation(["dapps", "common", "settings", "transfer"]);
  const [showDigest, setShowDigest] = useState(false);
  const decoded = tryDecodeUtf8(messageHex);
  const byteLength = messageHex.startsWith("0x")
    ? (messageHex.length - 2) / 2
    : 0;

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4 text-sm">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{t("dapps:message")}</span>
        <span className="text-muted-foreground">
          {t("dapps:bytes", { count: byteLength })}
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
              {t("dapps:rawBytes")}
            </summary>
            <p
              className="mt-2 max-h-32 overflow-auto break-all font-mono"
              dir="ltr"
            >
              {messageHex}
            </p>
          </details>
        </>
      ) : (
        <div>
          <p className="text-xs text-muted-foreground italic">
            {t("dapps:binaryMessage")}
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
          onToggle={(e) => {
            const details = e.currentTarget;
            if (details instanceof HTMLDetailsElement)
              setShowDigest(details.open);
          }}
        >
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {t("dapps:digest")}
          </summary>
          <p className="mt-2 break-all font-mono" dir="ltr">
            {digestHex}
          </p>
        </details>
      )}
    </div>
  );
};

export default DAppMessageReview;
