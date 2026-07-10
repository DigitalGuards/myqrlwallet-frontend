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
import { getMnemonicFromHexSeed } from "@/utils/crypto";
import { copyToClipboard } from "@/utils/nativeApp";
import { withSuspense } from "@/utils/react";
import type { Web3BaseWalletAccount } from "@theqrl/web3";
import { Check, Copy, HardDriveDownload, QrCode, Undo } from "lucide-react";
import { lazy, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { WalletEncryptionUtil } from "@/utils/crypto";
import { HexSeedListing } from "@/components/UI/HexSeedListing/HexSeedListing";
import { ROUTES } from "@/router/router";
import { isDesktop } from "@/desktop/bridge";

const MnemonicWordListing = withSuspense(
  lazy(() => import("./MnemonicWordListing/MnemonicWordListing"))
);

type MnemonicDisplayProps = {
  account?: Web3BaseWalletAccount;
  userPassword: string;
  // Desktop only: the signer-supplied address + one-time mnemonic. The hex seed
  // never leaves the signer, so the hex-seed and wallet-file sections are
  // hidden on desktop.
  desktopBackup?: { address: string; mnemonic: string };
};

const MnemonicDisplay = ({
  account,
  userPassword,
  desktopBackup,
}: MnemonicDisplayProps) => {
  const navigate = useNavigate();
  // On desktop the address + mnemonic come from the signer; the hex seed is
  // never available in the renderer.
  const accountAddress = isDesktop ? desktopBackup?.address : account?.address;
  const accountHexSeed = isDesktop ? undefined : account?.seed;
  const mnemonic = isDesktop ? (desktopBackup?.mnemonic ?? "") : getMnemonicFromHexSeed(accountHexSeed);
  const [hasJustCopiedSeed, setHasJustCopiedSeed] = useState(false);
  const [hasJustCopiedAddress, setHasJustCopiedAddress] = useState(false);
  const [hasJustCopiedMnemonic, setHasJustCopiedMnemonic] = useState(false);

  const onProceed = () => {
    navigate(ROUTES.HOME);
  };

  const onCopyMnemonic = async () => {
    if (mnemonic) {
      const success = await copyToClipboard(mnemonic);
      if (success) {
        setHasJustCopiedMnemonic(true);
        setTimeout(() => {
          setHasJustCopiedMnemonic(false);
        }, 1000);
      }
    }
  };

  const onCopyHexSeed = async () => {
    if (accountHexSeed) {
      const success = await copyToClipboard(accountHexSeed);
      if (success) {
        setHasJustCopiedSeed(true);
        setTimeout(() => {
          setHasJustCopiedSeed(false);
        }, 1000);
      }
    }
  };

  const onCopyAddress = async () => {
    if (accountAddress) {
      const success = await copyToClipboard(accountAddress);
      if (success) {
        setHasJustCopiedAddress(true);
        setTimeout(() => {
          setHasJustCopiedAddress(false);
        }, 1000);
      }
    }
  };

  const onDownloadEncrypted = async () => {
    if (account && mnemonic && accountHexSeed) {
      const extendedAccount = {
        ...account,
        mnemonic,
        hexSeed: accountHexSeed
      };
      try {
        await WalletEncryptionUtil.downloadWallet(extendedAccount, userPassword);
      } catch (error) {
        console.error("Failed to download encrypted wallet:", error);
      }
    }
  };

  const onDownloadUnencrypted = async () => {
    if (account && mnemonic && accountHexSeed) {
      const extendedAccount = {
        ...account,
        mnemonic,
        hexSeed: accountHexSeed
      };
      try {
        await WalletEncryptionUtil.downloadWallet(extendedAccount);
      } catch (error) {
        console.error("Failed to download wallet:", error);
      }
    }
  };

  const cardDescription = "Don't lose this recovery information. Download it right now. You may need this someday to import or recover your new account";
  const continueWarning =
    "You should only continue if you have downloaded the recovery information. If you haven't, go back, download, and then continue. There is no going back once you click the continue button.";

  return (
    <Card className="w-full max-w-2xl border-l-4 border-l-primary">
      <CardHeader>
        <CardTitle>Your Recovery Information</CardTitle>
        <CardDescription className="flex flex-col gap-2">
          <span>{cardDescription}</span>
          <span className="text-primary break-all">{accountAddress}</span>
          <span className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCopyAddress}
            >
              <Copy className="mr-2 h-4 w-4" />
              {hasJustCopiedAddress ? "Copied" : "Copy Address"}
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <QrCode className="mr-2 h-4 w-4" />
                  View QR
                </Button>
              </DialogTrigger>
              <DialogContent className="w-fit rounded-md">
                <DialogHeader className="text-left">
                  <DialogTitle>Wallet Address QR Code</DialogTitle>
                  <DialogDescription>
                    Scan this QR code to get the wallet address
                  </DialogDescription>
                </DialogHeader>
                <div className="flex justify-center p-4">
                  <QRCodeSVG
                    value={accountAddress || ""}
                    size={200}
                    bgColor="#000000"
                    fgColor="#ffffff"
                    level="L"
                    includeMargin={false}
                  />
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="outline" className="w-full">
                      Close
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Mnemonic Phrases</h3>
            <p className="text-sm text-muted-foreground">These words can be used to recover your account</p>
            <MnemonicWordListing mnemonic={mnemonic} />
            <Button
              type="button"
              variant="outline"
              onClick={onCopyMnemonic}
              className="w-full mt-2"
            >
              <Copy className="mr-2 h-4 w-4" />
              {hasJustCopiedMnemonic ? "Copied" : "Copy Mnemonic"}
            </Button>
          </div>
          {/* Hex seed is web/native only: on desktop it never leaves the
              signer, so there is nothing to display or copy here. */}
          {!isDesktop && (
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
          )}
        </div>
      </CardContent>
      <CardFooter className="flex-col gap-4">
        {/* Wallet-file downloads require the hex seed, which the renderer does
            not have on desktop. Hidden there; the mnemonic above is the backup. */}
        {!isDesktop && (
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
        )}
        <Dialog>
          <DialogTrigger asChild>
            <Button className="w-full" type="button">
              <Check className="mr-2 h-4 w-4" />
              Done
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
                <Check className="mr-2 h-4 w-4" />
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
};

export default MnemonicDisplay;
