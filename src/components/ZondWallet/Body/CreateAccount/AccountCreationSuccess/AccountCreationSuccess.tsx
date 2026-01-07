import { Button } from "../../../../UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../../UI/Card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../../UI/Dialog";
import { ROUTES } from "../../../../../router/router";
import { getExplorerAddressUrl } from "@/config";
import { copyToClipboard, openExternalUrl } from "@/utils/nativeApp";
import { useStore } from "../../../../../stores/store";
import { Check, Copy, ExternalLink, HardDriveDownload, Undo } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { WalletEncryptionUtil, ExtendedWalletAccount } from "@/utils/crypto";

type AccountCreationSuccessProps = {
  account?: ExtendedWalletAccount;
  userPassword: string;
  mnemonic: string;
  hexSeed: string;
};

export const AccountCreationSuccess = ({
  account,
  userPassword,
  mnemonic,
  hexSeed,
}: AccountCreationSuccessProps) => {
  const { zondStore } = useStore();
  const { zondConnection } = zondStore;
  const { blockchain } = zondConnection;

  // Create extended account with mnemonic and hexSeed
  const extendedAccount = account ? {
    ...account,
    mnemonic,
    hexSeed,
  } : undefined;

  const accountAddress = extendedAccount?.address ?? "";
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
      openExternalUrl(getExplorerAddressUrl(accountAddress, blockchain));
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Account created</CardTitle>
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
        <div className="flex flex-col sm:flex-row w-full gap-3">
          <Button
            className="w-full"
            type="button"
            variant="outline"
            onClick={() => WalletEncryptionUtil.downloadWallet(extendedAccount, userPassword)}
          >
            <HardDriveDownload className="mr-2 h-4 w-4" />
            <span className="whitespace-nowrap">Download Encrypted</span>
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button className="w-full" type="button" variant="outline">
                <HardDriveDownload className="mr-2 h-4 w-4" />
                <span className="whitespace-nowrap">Download Unencrypted</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="w-80 rounded-md">
              <DialogHeader className="text-left">
                <DialogTitle>Warning!</DialogTitle>
                <DialogDescription>
                  You are about to download an unencrypted wallet file. This file will contain sensitive information and should never be shared. Are you sure you want to proceed?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex flex-row gap-4">
                <DialogClose asChild>
                  <Button className="w-full" type="button" variant="outline">
                    <Undo className="mr-2 h-4 w-4" />
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  className="w-full"
                  type="button"
                  onClick={() => WalletEncryptionUtil.downloadWallet(extendedAccount)}
                >
                  <HardDriveDownload className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
