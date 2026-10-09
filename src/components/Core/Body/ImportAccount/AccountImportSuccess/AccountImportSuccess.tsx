import { PageShell } from "@/components/Core/Layout/PageShell";
import { Button } from "../../../../UI/Button";
import { Card, CardContent, CardFooter } from "../../../../UI/Card";
import { ROUTES } from "../../../../../router/router";
import { getExplorerAddressUrl } from "@/config";
import { copyToClipboard, openExternalUrl } from "@/utils/nativeApp";
import { useStore } from "../../../../../stores/store";
import type { Web3BaseWalletAccount } from "@theqrl/web3";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { QrlAddress } from "@/components/UI/QrlAddress";

type AccountImportSuccessProps = {
  account?: Web3BaseWalletAccount;
};

const AccountImportSuccess = ({ account }: AccountImportSuccessProps) => {
  const { qrlStore } = useStore();
  const { qrlConnection } = qrlStore;
  const { blockchain } = qrlConnection;

  const accountAddress = account?.address ?? "";

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
      openExternalUrl(getExplorerAddressUrl(accountAddress, blockchain));
    }
  };

  return (
    <PageShell
      title={
        <span className="flex items-center gap-2">
          <Check className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          Account imported
        </span>
      }
      seoTitle="Import Account"
    >
      <Card className="w-full">
        <CardContent className="space-y-8 pt-6">
          <div className="flex flex-col gap-2">
            <div>Account public address:</div>
            <QrlAddress
              address={accountAddress}
              mode="full"
              className="w-full"
              addressClassName="font-bold text-identity-accent"
            />
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
              View on Explorer
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
    </PageShell>
  );
};

export default AccountImportSuccess;
