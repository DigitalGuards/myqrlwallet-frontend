import { Button } from "../../../../UI/Button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { getMnemonicFromHexSeed } from "../../../../../functions/getMnemonicFromHexSeed";
import withSuspense from "../../../../../functions/withSuspense";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { ArrowRight, Copy, HardDriveDownload, Undo } from "lucide-react";
import { lazy, useState } from "react";
import { WalletEncryptionUtil } from "../../../../../utilities/walletEncryptionUtil";
import { HexSeedListing } from "@/components/UI/HexSeedListing/HexSeedListing";

const MnemonicWordListing = withSuspense(
  lazy(() => import("./MnemonicWordListing/MnemonicWordListing"))
);

type MnemonicDisplayProps = {
  account?: Web3BaseWalletAccount;
  userPassword: string;
  onMnemonicNoted: (mnemonic: string, hexSeed: string) => void;
};

const MnemonicDisplay = ({
  account,
  userPassword,
  onMnemonicNoted,
}: MnemonicDisplayProps) => {
  const accountAddress = account?.address;
  const accountHexSeed = account?.seed;
  const mnemonic = getMnemonicFromHexSeed(accountHexSeed);
  const [hasJustCopiedSeed, setHasJustCopiedSeed] = useState(false);

  const onProceed = () => {
    if (mnemonic && accountHexSeed) {
      onMnemonicNoted(mnemonic, accountHexSeed);
    }
  };

  const onCopyHexSeed = () => {
    if (accountHexSeed) {
      navigator.clipboard.writeText(accountHexSeed);
      setHasJustCopiedSeed(true);
      setTimeout(() => {
        setHasJustCopiedSeed(false);
      }, 1000);
    }
  };

  const onDownloadEncrypted = () => {
    if (account && mnemonic && accountHexSeed) {
      const extendedAccount = {
        ...account,
        mnemonic,
        hexSeed: accountHexSeed
      };
      WalletEncryptionUtil.downloadWallet(extendedAccount, userPassword);
    }
  };

  const onDownloadUnencrypted = () => {
    if (account && mnemonic && accountHexSeed) {
      const extendedAccount = {
        ...account,
        mnemonic,
        hexSeed: accountHexSeed
      };
      WalletEncryptionUtil.downloadWallet(extendedAccount);
    }
  };

  const cardDescription = `Don't lose this recovery information. Download it right now. You may need this someday to import or recover your new account ${accountAddress?.substring(0, 5)}...${accountAddress?.substring(accountAddress?.length - 5)}`;
  const continueWarning =
    "You should only continue if you have downloaded the recovery information. If you haven't, go back, download, and then continue. There is no going back once you click the continue button.";

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Your Recovery Information</CardTitle>
        <CardDescription>{cardDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Mnemonic Phrases</h3>
            <p className="text-sm text-muted-foreground">These words can be used to recover your account</p>
            <MnemonicWordListing mnemonic={mnemonic} />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Hex Seed</h3>
            <p className="text-sm text-muted-foreground">Alternative method to recover your account</p>
            <div className="mt-2 flex flex-col gap-2">
              {accountHexSeed && <HexSeedListing hexSeed={accountHexSeed} />}
              <Button
                type="button"
                variant="outline"
                onClick={onCopyHexSeed}
                className="w-full"
              >
                {hasJustCopiedSeed ? (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Hex Seed
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex-col gap-4">
        <div className="flex flex-col sm:flex-row w-full gap-3">
          <Button
            className="w-full"
            type="button"
            variant="outline"
            onClick={onDownloadEncrypted}
          >
            <HardDriveDownload className="mr-2 h-4 w-4" />
            <span className="whitespace-nowrap">Download Encrypted Wallet File</span>
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button className="w-full" type="button" variant="outline">
                <HardDriveDownload className="mr-2 h-4 w-4" />
                <span className="whitespace-nowrap">Download Unencrypted Wallet File</span>
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
                  onClick={onDownloadUnencrypted}
                >
                  <HardDriveDownload className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="w-full" type="button">
              <ArrowRight className="mr-2 h-4 w-4" />
              Continue
            </Button>
          </DialogTrigger>
          <DialogContent className="w-80 rounded-md">
            <DialogHeader className="text-left">
              <DialogTitle>Warning!</DialogTitle>
              <DialogDescription>{continueWarning}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex flex-row gap-4">
              <DialogClose asChild>
                <Button className="w-full" type="button" variant="outline">
                  <Undo className="mr-2 h-4 w-4" />
                  Go Back
                </Button>
              </DialogClose>
              <Button className="w-full" type="button" onClick={onProceed}>
                <ArrowRight className="mr-2 h-4 w-4" />
                Continue
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
};

export default MnemonicDisplay;
