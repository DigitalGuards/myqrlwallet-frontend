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
import { ArrowRight, HardDriveDownload, Undo } from "lucide-react";
import { lazy } from "react";
import { WalletEncryptionUtil } from "../../../../../utilities/walletEncryptionUtil";

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

  const onProceed = () => {
    if (mnemonic && accountHexSeed) {
      onMnemonicNoted(mnemonic, accountHexSeed);
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

  const cardDescription = `Don't lose this mnemonic phrases. Download it right now. You may need this someday to import or recover your new account ${accountAddress?.substring(0, 5)}...${accountAddress?.substring(accountAddress?.length - 5)}`;
  const continueWarning =
    "You should only continue if you have downloaded the mnemonic phrases. If you haven't, go back, download, and then continue. There is no going back once you click the continue button.";

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Your mnemonic phrases</CardTitle>
        <CardDescription>{cardDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <MnemonicWordListing mnemonic={mnemonic} />
      </CardContent>
      <CardFooter className="flex-col gap-4">
        <div className="flex w-full gap-4">
          <Button
            className="w-full"
            type="button"
            variant="outline"
            onClick={onDownloadEncrypted}
          >
            <HardDriveDownload className="mr-2 h-4 w-4" />
            Download Encrypted Wallet
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button className="w-full" type="button" variant="outline">
                <HardDriveDownload className="mr-2 h-4 w-4" />
                Download Unencrypted Wallet
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
