import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { QrlAddress } from "@/components/UI/QrlAddress";
import { getExplorerTxUrl } from "@/config";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import type { TransactionStatus } from "@/stores/qrlStore";
import { Check, Copy, ExternalLink, Loader } from "lucide-react";

export function SendStatus({
  status,
  blockchain,
  onBack,
}: {
  status: TransactionStatus;
  blockchain: string;
  onBack: () => void;
}) {
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
      ? "Approve this transaction in the MyQRLWallet app on your phone"
      : details?.signer === "desktop"
        ? "Approve this transaction in the MyQRLWallet desktop signer"
        : "Approve this transaction in the MyQRLWallet extension";
  const title =
    state === "awaiting-approval"
      ? "Waiting for approval"
      : sent
        ? "Signed and sent"
        : state === "timeout"
          ? "Signed and sent: still waiting for confirmation"
          : state === "rejected"
            ? "Transaction rejected"
            : failed
              ? "Transaction failed"
              : "Preparing transaction";
  const message =
    state === "awaiting-approval"
      ? approval
      : sent
        ? "Your transaction was signed and broadcast. It is waiting to be included in a block."
        : state === "preparing" || state === "pending"
          ? "Preparing your transaction."
          : status.error;

  return (
    <div className="flex w-full min-w-0 items-start justify-center py-2 md:py-8">
      <div className="page-enter w-full min-w-0 max-w-2xl px-2 md:px-4">
        <Card
          className={`w-full border-l-4 ${failed ? "border-l-destructive" : "border-l-primary"}`}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2" aria-live="polite">
              {busy && (
                <Loader
                  className="h-5 w-5 shrink-0 animate-spin"
                  aria-hidden="true"
                />
              )}
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p
              className={failed ? "text-destructive" : "text-muted-foreground"}
              role="status"
            >
              {message}
            </p>
            {details && (
              <dl className="space-y-6">
                <div className="space-y-2">
                  <dt>Amount</dt>
                  <dd className="font-numeric break-all font-bold text-secondary">
                    {details.amount} {details.asset}
                  </dd>
                </div>
                <div className="space-y-2">
                  <dt>Recipient</dt>
                  <dd>
                    <QrlAddress
                      address={details.to}
                      mode="full"
                      copyable
                      copyLabel="Copy recipient address"
                    />
                  </dd>
                </div>
              </dl>
            )}
            {txHash && (
              <div className="space-y-2">
                <div>Transaction hash</div>
                <div className="flex min-w-0 items-center gap-2">
                  <a
                    href={getExplorerTxUrl(
                      txHash,
                      details?.blockchain ?? blockchain,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={txHash}
                    aria-label={`View transaction ${txHash} on explorer`}
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
                        ? "Transaction hash copied"
                        : "Copy transaction hash"
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
          {!busy && (
            <CardFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onBack}
                className="w-full"
              >
                {state === "timeout" ? "Done" : "Back to form"}
              </Button>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}
