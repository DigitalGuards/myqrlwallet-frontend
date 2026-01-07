import { Button } from "../../../../UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../../UI/Card";
import { ROUTES } from "../../../../../router/router";
import { getExplorerAddressUrl } from "@/config";
import { copyToClipboard } from "@/utils/nativeApp";
import { useStore } from "../../../../../stores/store";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

type AccountImportSuccessProps = {
  account?: Web3BaseWalletAccount;
};

const AccountImportSuccess = ({
  account,
}: AccountImportSuccessProps) => {
  const { zondStore } = useStore();
  const { zondConnection } = zondStore;
  const { blockchain } = zondConnection;

  const accountAddress = account?.address ?? "";
  const accountAddressSplit = [];
  for (let i = 1; i < accountAddress.length; i += 4) {
    accountAddressSplit.push(accountAddress.substring(i, i + 4));
  }
  const spacedAccountAddress = accountAddressSplit.join(" ");

  const [hasJustCopied, setHasJustCopied] = useState(false);
  const [timer, setTimer] = useState<NodeJS.Timeout>();

  useEffect(() => {
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [timer]);

  const onCopy = async () => {
    const success = await copyToClipboard(accountAddress);
    if (success) {
      setHasJustCopied(true);
      const newTimer = setTimeout(() => {
        setHasJustCopied(false);
      }, 1000);
      setTimer(newTimer);
    }
  };

  const onViewInExplorer = () => {
    if (accountAddress) {
      window.open(getExplorerAddressUrl(accountAddress, blockchain), '_blank');
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Account imported</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="flex flex-col gap-2">
          <div>Account public address:</div>
          <div className="font-bold text-secondary">{`Z ${spacedAccountAddress}`}</div>
          <div>
            You can share this account public address with anyone. Others need
            it to interact with you.
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex-col gap-4">
        <div className="flex w-full gap-4">
          <Button
            className="w-full"
            type="button"
            variant="outline"
            onClick={onCopy}
          >
            <Copy className="mr-2 h-4 w-4" />
            {hasJustCopied ? "Copied" : "Copy"}
          </Button>
          <Button
            className="w-full"
            type="button"
            variant="outline"
            onClick={onViewInExplorer}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            View in Zondscan
          </Button>
        </div>
        <Link className="w-full" to={ROUTES.HOME}>
          <Button className="w-full" type="button">
            <Check className="mr-2 h-4 w-4" />
            Done
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
};

export default AccountImportSuccess;
