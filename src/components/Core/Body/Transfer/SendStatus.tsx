import { useTranslation } from "react-i18next";
import { transferMessage } from "@/i18n/transferMessage";
import type { BlockchainSelection } from "@/utils/storage/storage";
import { renderValue } from "@/utils/guards";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardFooter } from "@/components/UI/Card";
import { QrlAddress } from "@/components/UI/QrlAddress";
import { getExplorerTxUrl } from "@/config";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import type { TransactionStatus } from "@/stores/qrlStore";
import { Check, Copy, ExternalLink, Loader, XCircle } from "lucide-react";

export function SendStatus({
  status,
  blockchain,
  onBack,
}: {
  status: TransactionStatus;
  blockchain: BlockchainSelection;
  onBack: () => void;
}) {
  const { t } = useTranslation(["transfer", "common", "settings"]);
  const { copiedItem, copyToClipboard } = useCopyToClipboard<"hash">();
  const { state, details, txHash } = status;
  const failed = state === "failed";
  const sent = state === "pending" && txHash !== null;
  const busy =
    state === "preparing" ||
    state === "awaiting-approval" ||
    state === "pending";
  const approval =
    details?.signer === "mobile"
      ? t("transfer:approveMobile")
      : details?.signer === "desktop"
        ? t("transfer:approveDesktop")
        : t("transfer:approveExtension");
  const title =
    state === "awaiting-approval"
      ? t("transfer:waitingApproval")
      : sent
        ? t("transfer:signedSent")
        : state === "timeout"
          ? t("transfer:stillWaiting")
          : state === "rejected"
            ? t("transfer:rejected")
            : failed
              ? t("transfer:failed")
              : t("transfer:preparingTitle");
  const message =
    state === "awaiting-approval"
      ? approval
      : sent
        ? t("transfer:broadcast")
        : state === "preparing" || state === "pending"
          ? t("transfer:preparing")
          : transferMessage(status.error, t);

  return (
    <PageShell
      title={
        <span className="flex items-center gap-2" aria-live="polite">
          {busy && (
            <Loader
              className="h-5 w-5 shrink-0 animate-spin text-primary"
              aria-hidden="true"
            />
          )}
          {(failed || state === "rejected") && (
            <XCircle
              className="h-5 w-5 shrink-0 text-destructive"
              aria-hidden="true"
            />
          )}
          {title}
        </span>
      }
      seoTitle={t("transfer:title")}
    >
      <Card className="w-full">
        <CardContent className="space-y-6 pt-6">
          <p
            className={failed ? "text-destructive" : "text-muted-foreground"}
            role="status"
          >
            {message}
          </p>
          {details && (
            <dl className="space-y-6">
              <div className="space-y-2">
                <dt>{t("transfer:amount")}</dt>
                <dd className="font-numeric break-all font-bold text-secondary">
                  {details.amount} {renderValue(details.asset)}
                </dd>
              </div>
              <div className="space-y-2">
                <dt>{t("transfer:recipient")}</dt>
                <dd>
                  <QrlAddress
                    address={details.to}
                    mode="full"
                    copyable
                    copyLabel={t("transfer:copyRecipient")}
                  />
                </dd>
              </div>
            </dl>
          )}
          {txHash && (
            <div className="space-y-2">
              <div>{t("transfer:hash")}</div>
              <div className="flex min-w-0 items-center gap-2">
                <a
                  href={getExplorerTxUrl(
                    txHash,
                    details?.blockchain ?? blockchain,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={txHash}
                  aria-label={t("transfer:viewTransaction", { hash: txHash })}
                  className="flex min-w-0 items-center gap-2 text-secondary hover:text-secondary/80"
                >
                  <span className="break-all font-mono text-sm">
                    {txHash.slice(0, 10)}...{txHash.slice(-8)}
                  </span>
                  <ExternalLink
                    className="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={
                    copiedItem === "hash"
                      ? t("transfer:hashCopied")
                      : t("transfer:copyHash")
                  }
                  onClick={() => {
                    void copyToClipboard(txHash, "hash");
                  }}
                >
                  {copiedItem === "hash" ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
        {(state === "awaiting-approval" || sent || !busy) && (
          <CardFooter className="flex-col gap-3">
            {state === "awaiting-approval" && (
              <p className="text-sm text-muted-foreground">
                {t("transfer:checkSigner")}
              </p>
            )}
            {sent && (
              <p className="text-sm text-muted-foreground">
                {t("transfer:followHistory")}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              className="w-full"
            >
              {state === "timeout" ? t("transfer:done") : t("transfer:back")}
            </Button>
          </CardFooter>
        )}
      </Card>
    </PageShell>
  );
}
