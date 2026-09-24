import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { getOptimalTokenBalance } from "@/utils/formatting";
import type { TransactionReceipt } from "@theqrl/web3";
import { utils } from "@theqrl/web3";
import { BigNumber } from "bignumber.js";
import { Check, CheckCircle2, Copy, ExternalLink } from "lucide-react";
import { QRL_PROVIDER } from "@/config";
import { useStore } from "@/stores/store";

type TransactionSuccessfulProps = {
  transactionReceipt: TransactionReceipt;
  amount?: string;
  assetSymbol?: string;
  onDone: () => void;
};

export const TransactionSuccessful = ({
  transactionReceipt,
  amount,
  assetSymbol,
  onDone,
}: TransactionSuccessfulProps) => {
  const { qrlStore } = useStore();
  const { qrlConnection } = qrlStore;
  const { blockchain } = qrlConnection;

  const {
    blockHash,
    blockNumber,
    transactionHash,
    gasUsed,
    effectiveGasPrice,
  } = transactionReceipt;

  const { copiedItem, copyToClipboard } = useCopyToClipboard<
    "txHash" | "blockHash"
  >();

  const explorerUrl =
    QRL_PROVIDER[blockchain as keyof typeof QRL_PROVIDER]?.explorer ||
    "https://zondscan.com";

  const gasInQrl = new BigNumber(
    utils.fromPlanck(
      BigInt(gasUsed) * BigInt(effectiveGasPrice ?? 0),
      "quanta",
    ),
  )
    .dp(8, BigNumber.ROUND_DOWN)
    .toString()
    .replace(/\.?0+$/, "");

  const formattedAmount = amount
    ? getOptimalTokenBalance(amount, assetSymbol)
    : null;

  return (
    <div className="flex min-w-0 w-full items-start justify-center py-2 md:py-8">
      <div className="relative min-w-0 w-full max-w-2xl px-2 md:px-4">
        <img
          className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
          src="/tree.svg"
          alt="Background Tree"
        />
        <Card className="min-w-0 w-full border-l-4 border-l-success">
          <CardHeader className="bg-gradient-to-r from-success/10 to-transparent px-4 sm:px-6">
            <CardTitle className="flex items-center gap-2 text-xl leading-tight sm:text-2xl">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                Transaction Completed
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 px-4 pt-6 sm:px-6">
            {formattedAmount && (
              <div className="flex flex-col gap-2">
                <div>Amount</div>
                <div className="font-numeric font-bold text-secondary break-all">
                  {formattedAmount}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <div>Transaction Hash</div>
              <div className="flex min-w-0 items-center gap-2">
                <a
                  href={`${explorerUrl}/tx/${transactionHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View transaction ${transactionHash} on explorer`}
                  className="flex min-w-0 flex-1 items-center gap-2 text-secondary hover:text-secondary/80"
                >
                  <span className="min-w-0 break-all font-mono text-sm font-medium leading-relaxed">
                    {transactionHash.toString()}
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
                    copiedItem === "txHash"
                      ? "Transaction hash copied"
                      : "Copy transaction hash"
                  }
                  onClick={() =>
                    copyToClipboard(transactionHash.toString(), "txHash")
                  }
                  className="shrink-0 text-secondary hover:text-secondary/80"
                >
                  {copiedItem === "txHash" ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div>Block hash</div>
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 break-all font-mono text-sm font-medium leading-relaxed text-secondary">
                  {blockHash.toString()}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={
                    copiedItem === "blockHash"
                      ? "Block hash copied"
                      : "Copy block hash"
                  }
                  onClick={() =>
                    copyToClipboard(blockHash.toString(), "blockHash")
                  }
                  className="shrink-0 text-secondary hover:text-secondary/80"
                >
                  {copiedItem === "blockHash" ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <div>Block number</div>
                <a
                  href={`${explorerUrl}/block/${blockNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-2 font-numeric font-bold text-secondary hover:text-secondary/80"
                >
                  <span className="min-w-0 break-all">
                    {blockNumber.toString()}
                  </span>
                  <ExternalLink
                    className="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                </a>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <div>Gas used</div>
                <div className="font-numeric font-bold text-secondary break-all">
                  {gasInQrl} Quanta
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-end px-4 sm:px-6">
            <Button className="w-full sm:w-1/2" type="button" onClick={onDone}>
              <Check className="mr-2 h-4 w-4" />
              Done
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};
