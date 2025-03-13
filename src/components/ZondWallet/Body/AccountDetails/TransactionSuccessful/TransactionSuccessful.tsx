import { Button } from "../../../../UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../../UI/Card";
import { ROUTES } from "../../../../../router/router";
import StringUtil from "../../../../../utilities/stringUtil";
import { TransactionReceipt, utils } from "@theqrl/web3";
import { Check, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

type TransactionSuccessfulProps = {
  transactionReceipt: TransactionReceipt;
};

export const TransactionSuccessful = ({
  transactionReceipt,
}: TransactionSuccessfulProps) => {
  const {
    blockHash,
    blockNumber,
    transactionHash,
    gasUsed,
    effectiveGasPrice,
  } = transactionReceipt;

  return (
    <div className="w-full">
      <img
        className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
        src="/tree.svg"
        alt="Background Tree"
      />
      <div className="relative z-10 p-8">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Transaction completed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="flex flex-col gap-2">
              <div>Transaction Hash</div>
              <a
                href={`https://zondscan.com/pending/tx/${transactionHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 font-bold text-secondary hover:text-secondary/80"
              >
                {StringUtil.getSplitAddress(transactionHash.toString())}
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
            <div className="flex flex-col gap-2">
              <div>Block hash</div>
              <div className="font-bold text-secondary">
                {StringUtil.getSplitAddress(blockHash.toString())}
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
                <div className="font-bold text-secondary">
                  {`${utils.fromWei(
                    BigInt(gasUsed) * BigInt(effectiveGasPrice ?? 0),
                    "ether"
                  )} QRL`}
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="grid grid-cols-2 gap-4">
            <span />
            <Link className="w-full" to={ROUTES.HOME}>
              <Button className="w-full" type="button">
                <Check className="mr-2 h-4 w-4" />
                Done
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};
