import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import StringUtil from "@/utilities/stringUtil";
import { TransactionReceipt, utils } from "@theqrl/web3";
import { BigNumber } from "bignumber.js";
import { Check, Copy, ExternalLink } from "lucide-react";

type TransactionSuccessfulProps = {
  transactionReceipt: TransactionReceipt;
  onDone: () => void;
};

export const TransactionSuccessful = ({
  transactionReceipt,
  onDone,
}: TransactionSuccessfulProps) => {
  const {
    blockHash,
    blockNumber,
    transactionHash,
    gasUsed,
    effectiveGasPrice,
  } = transactionReceipt;

  const { copiedItem, copyToClipboard } = useCopyToClipboard<"txHash" | "blockHash">();

  const gasInQrl = new BigNumber(
    utils.fromWei(BigInt(gasUsed) * BigInt(effectiveGasPrice ?? 0), "ether")
  )
    .dp(8, BigNumber.ROUND_DOWN)
    .toString()
    .replace(/\.?0+$/, "");

  return (
    <div className="flex w-full items-start justify-center py-8 overflow-x-hidden">
      <div className="relative w-full max-w-2xl px-4">
        <img
          className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
          src="/tree.svg"
          alt="Background Tree"
        />
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Transaction completed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="flex flex-col gap-2">
              <div>Transaction Hash</div>
              <div className="flex items-center gap-2">
                <a
                  href={`https://zondscan.com/pending/tx/${transactionHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-secondary hover:text-secondary/80"
                >
                  <span className="font-bold">
                    {StringUtil.getSplitAddress(transactionHash.toString())}
                  </span>
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  onClick={() => copyToClipboard(transactionHash.toString(), "txHash")}
                  className="text-secondary hover:text-secondary/80"
                >
                  {copiedItem === "txHash" ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div>Block hash</div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-secondary">
                  {StringUtil.getSplitAddress(blockHash.toString())}
                </span>
                <button
                  onClick={() => copyToClipboard(blockHash.toString(), "blockHash")}
                  className="text-secondary hover:text-secondary/80"
                >
                  {copiedItem === "blockHash" ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-8">
              <div className="flex flex-col gap-2">
                <div>Block number</div>
                <a
                  href={`https://zondscan.com/block/${blockNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 font-bold text-secondary hover:text-secondary/80"
                >
                  {blockNumber.toString()}
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <div className="flex flex-col gap-2">
                <div>Gas used</div>
                <div className="font-bold text-secondary break-all">
                  {gasInQrl} QRL
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="grid grid-cols-2 gap-4">
            <span />
            <Button className="w-full" type="button" onClick={onDone}>
              <Check className="mr-2 h-4 w-4" />
              Done
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};
