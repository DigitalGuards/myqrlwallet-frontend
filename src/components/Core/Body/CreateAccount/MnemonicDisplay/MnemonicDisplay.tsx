import { useTranslation } from "react-i18next";
import { logger } from "@/utils/log";
import { Button } from "../../../../UI/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
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
import { useNavigate } from "react-router";
import { QRCodeSVG } from "qrcode.react";
import { WalletEncryptionUtil } from "@/utils/crypto";
import { HexSeedListing } from "@/components/UI/HexSeedListing/HexSeedListing";
import { ROUTES } from "@/router/router";
import { isDesktop } from "@/desktop/bridge";
import { QrlAddress } from "@/components/UI/QrlAddress";

const MnemonicWordListing = withSuspense(
  lazy(() => import("./MnemonicWordListing/MnemonicWordListing")),
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
  const { t } = useTranslation(["onboarding", "common", "settings"]);
  const navigate = useNavigate();
  // On desktop the address + mnemonic come from the signer; the hex seed is
  // never available in the renderer.
  const accountAddress = isDesktop ? desktopBackup?.address : account?.address;
  const accountHexSeed = isDesktop ? undefined : account?.seed;
  const mnemonic = isDesktop
    ? (desktopBackup?.mnemonic ?? "")
    : getMnemonicFromHexSeed(accountHexSeed);
  const [hasJustCopiedSeed, setHasJustCopiedSeed] = useState(false);
  const [hasJustCopiedAddress, setHasJustCopiedAddress] = useState(false);
  const [hasJustCopiedMnemonic, setHasJustCopiedMnemonic] = useState(false);

  const onProceed = () => {
    Promise.resolve(navigate(ROUTES.HOME)).catch((error: unknown) => {
      logger.error("Failed to open home:", error);
    });
  };

  const onCopyMnemonic = async () => {
    if (mnemonic) {
      // The recovery phrase is the wallet, so the app flags the clipboard
      // entry and clears it.
      const success = await copyToClipboard(mnemonic, true);
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
      // The hex seed is the wallet too.
      const success = await copyToClipboard(accountHexSeed, true);
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
        hexSeed: accountHexSeed,
      };
      try {
        await WalletEncryptionUtil.downloadWallet(
          extendedAccount,
          userPassword,
        );
      } catch (error) {
        logger.error("Failed to download encrypted wallet:", error);
      }
    }
  };

  const onDownloadUnencrypted = async () => {
    if (account && mnemonic && accountHexSeed) {
      const extendedAccount = {
        ...account,
        mnemonic,
        hexSeed: accountHexSeed,
      };
      try {
        await WalletEncryptionUtil.downloadWallet(extendedAccount);
      } catch (error) {
        logger.error("Failed to download wallet:", error);
      }
    }
  };

  const cardDescription = t("onboarding:backupNow");
  const continueWarning = t("onboarding:backupConfirm");

  return (
    <Card className="w-full">
      <CardHeader>
        <CardDescription className="flex flex-col gap-2">
          <span>{cardDescription}</span>
          <QrlAddress
            address={accountAddress || ""}
            mode="full"
            className="w-full"
            addressClassName="text-primary"
          />
          <span className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onCopyAddress().catch((error: unknown) => {
                  logger.error("Failed to copy address:", error);
                });
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              {hasJustCopiedAddress
                ? t("common:copied")
                : t("onboarding:copyAddress")}
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <QrCode className="mr-2 h-4 w-4" />
                  {t("onboarding:viewQr")}
                </Button>
              </DialogTrigger>
              <DialogContent className="w-fit rounded-md">
                <DialogHeader className="text-left">
                  <DialogTitle>{t("onboarding:addressQr")}</DialogTitle>
                  <DialogDescription>
                    {t("onboarding:scanAddress")}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex justify-center p-4">
                  <QRCodeSVG
                    value={accountAddress || ""}
                    size={200}
                    bgColor="#000000"
                    fgColor="#ffffff"
                    level="L"
                    marginSize={0}
                  />
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="outline" className="w-full">
                      {t("common:close")}
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
            <h3 className="text-lg font-semibold">
              {t("onboarding:mnemonicTitle")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("onboarding:mnemonicHelp")}
            </p>
            <MnemonicWordListing mnemonic={mnemonic} />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onCopyMnemonic().catch((error: unknown) => {
                  logger.error("Failed to copy mnemonic:", error);
                });
              }}
              className="w-full mt-2"
            >
              <Copy className="mr-2 h-4 w-4" />
              {hasJustCopiedMnemonic
                ? t("common:copied")
                : t("onboarding:copyMnemonic")}
            </Button>
          </div>
          {/* Hex seed is web/native only: on desktop it never leaves the
              signer, so there is nothing to display or copy here. */}
          {!isDesktop && (
            <div>
              <h3 className="text-lg font-semibold">
                {t("onboarding:hexSeed")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("onboarding:hexHelp")}
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {accountHexSeed && <HexSeedListing hexSeed={accountHexSeed} />}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onCopyHexSeed().catch((error: unknown) => {
                      logger.error("Failed to copy hex seed:", error);
                    });
                  }}
                  className="w-full"
                >
                  {hasJustCopiedSeed ? (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      {t("common:copied")}
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      {t("onboarding:copyHex")}
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
              onClick={() => {
                onDownloadEncrypted().catch((error: unknown) => {
                  logger.error("Failed to download encrypted wallet:", error);
                });
              }}
            >
              <HardDriveDownload className="mr-2 h-4 w-4" />
              <span className="whitespace-nowrap">
                {t("onboarding:downloadEncrypted")}
              </span>
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button className="w-full" type="button" variant="outline">
                  <HardDriveDownload className="mr-2 h-4 w-4" />
                  <span className="whitespace-nowrap">
                    {t("onboarding:downloadUnencrypted")}
                  </span>
                </Button>
              </DialogTrigger>
              <DialogContent className="w-80 rounded-md">
                <DialogHeader className="text-left">
                  <DialogTitle>{t("onboarding:warning")}</DialogTitle>
                  <DialogDescription>
                    {t("onboarding:unencryptedWarning")}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex flex-row gap-4">
                  <DialogClose asChild>
                    <Button className="w-full" type="button" variant="outline">
                      <Undo className="mr-2 h-4 w-4" />
                      {t("common:cancel")}
                    </Button>
                  </DialogClose>
                  <Button
                    className="w-full"
                    type="button"
                    onClick={() => {
                      onDownloadUnencrypted().catch((error: unknown) => {
                        logger.error("Failed to download wallet:", error);
                      });
                    }}
                  >
                    <HardDriveDownload className="mr-2 h-4 w-4" />
                    {t("onboarding:download")}
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
              {t("onboarding:done")}
            </Button>
          </DialogTrigger>
          <DialogContent className="w-80 rounded-md">
            <DialogHeader className="text-left">
              <DialogTitle>{t("onboarding:warning")}</DialogTitle>
              <DialogDescription>{continueWarning}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex flex-row gap-4">
              <DialogClose asChild>
                <Button className="w-full" type="button" variant="outline">
                  <Undo className="mr-2 h-4 w-4" />
                  {t("onboarding:goBack")}
                </Button>
              </DialogClose>
              <Button className="w-full" type="button" onClick={onProceed}>
                <Check className="mr-2 h-4 w-4" />
                {t("onboarding:done")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
};

export default MnemonicDisplay;
