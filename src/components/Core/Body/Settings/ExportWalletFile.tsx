import type { SettingsError } from "@/i18n/pinErrorMessage";
import {
  pinErrorMessage,
  settingsValidationMessage,
} from "@/i18n/pinErrorMessage";
import { Trans, useTranslation } from "react-i18next";
import { stringValue } from "@/utils/guards";
import {
  PinVerificationError,
  verifyPinWithLimit,
} from "@/utils/crypto/verifyPinWithLimit";
import { Button } from "../../../UI/Button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "../../../UI/Form";
import { Input } from "../../../UI/Input";
import { observer } from "mobx-react-lite";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useState, useEffect } from "react";
import { ChevronDown, FileDown } from "lucide-react";
import { StorageUtil } from "@/utils/storage";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import {
  WalletEncryptionUtil,
  decryptStoredSeedAsync,
  getAddressFromMnemonicAsync,
  CryptoOperationError,
  CryptoErrorCode,
} from "@/utils/crypto";
import { isInNativeApp } from "@/utils/nativeApp";
import { useStore } from "../../../../stores/store";
import { cn } from "@/utils/cn";
import { SettingsRow } from "./SettingsList";
import { logger } from "@/utils/log";
import { QrlAddress } from "@/components/UI/QrlAddress";
import { checkLockout } from "@/utils/crypto/pinAttemptTracker";

type ExportFormValues = {
  pin: string;
  filePassword: string;
  confirmFilePassword: string;
};

/**
 * Settings row + collapsible panel: export the ACTIVE account as an encrypted
 * wallet file. The PIN both authorizes the export and is mechanically required
 * to decrypt the stored seed; the file itself is encrypted under a separate
 * strong password (a 4-6 digit PIN is far too weak to protect a file that
 * leaves the browser). The exported v2 format is importable by this wallet
 * and by the MyQRLWallet browser extension.
 */
export const ExportWalletFile = observer(() => {
  const { t } = useTranslation(["settings", "common"]);
  const ExportSchema = z
    .object({
      pin: z.string().regex(/^\d{4,6}$/, "settings:pinFormat"),
      filePassword: z
        .string()
        .refine((value) => WalletEncryptionUtil.validatePassword(value), {
          message: "settings:passwordFormat",
        }),
      confirmFilePassword: z.string(),
    })
    .refine((data) => data.filePassword === data.confirmFilePassword, {
      message: "settings:passwordMatch",
      path: ["confirmFilePassword"],
    });

  const { qrlStore } = useStore();
  const activeAddress = qrlStore.activeAccount.accountAddress;

  const [showPanel, setShowPanel] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<SettingsError | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [pinLockout, setPinLockout] = useState<{
    isLocked: boolean;
    remainingMs: number;
  }>({ isLocked: false, remainingMs: 0 });

  // Shared lockout tracker with the Change PIN form: any wrong PIN counts.
  useEffect(() => {
    setPinLockout(checkLockout());
    const interval = setInterval(() => {
      setPinLockout(checkLockout());
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  const form = useForm<ExportFormValues>({
    resolver: zodResolver(ExportSchema),
    defaultValues: {
      pin: "",
      filePassword: "",
      confirmFilePassword: "",
    },
  });

  async function onSubmit(data: ExportFormValues) {
    setIsExporting(true);
    setExportError(null);
    setExportSuccess(false);

    try {
      if (!activeAddress) {
        setExportError({ key: "settings:exportNoAccount" });
        return;
      }
      const blockchain = await StorageUtil.getBlockChain();
      const seeds = await StorageUtil.getAllEncryptedSeeds(blockchain);
      const entry = seeds.find(
        (seed) =>
          stringValue(seed.address).toLowerCase() ===
          activeAddress.toLowerCase(),
      );
      if (!entry) {
        setExportError({ key: "settings:exportNoSeed" });
        return;
      }

      let decrypted: { mnemonic: string; hexSeed: string };
      try {
        decrypted = await verifyPinWithLimit(() =>
          decryptStoredSeedAsync(
            blockchain,
            stringValue(entry.address),
            entry.encryptedSeed,
            data.pin,
          ),
        );
      } catch (error) {
        if (error instanceof PinVerificationError) {
          setPinLockout(error);
          setExportError(pinErrorMessage(error));
        } else if (
          error instanceof CryptoOperationError &&
          error.code === CryptoErrorCode.OUTDATED_FORMAT
        ) {
          setExportError({ key: "settings:exportOldFormat" });
        } else if (
          error instanceof CryptoOperationError &&
          error.code === CryptoErrorCode.DEVICE_CREDENTIAL_UNAVAILABLE
        ) {
          setExportError({ key: "settings:credentialExport" });
        } else {
          setExportError({ key: "settings:unlockError" });
        }
        return;
      }

      const qrlInstance = qrlStore.qrlInstance;
      if (!qrlInstance) {
        setExportError({ key: "settings:connectionError" });
        return;
      }
      const derivedAddress = await getAddressFromMnemonicAsync(
        decrypted.mnemonic,
        qrlInstance,
      );
      if (
        derivedAddress.toLowerCase() !==
        stringValue(entry.address).toLowerCase()
      ) {
        setExportError({ key: "settings:seedMismatch" });
        return;
      }

      const account = {
        address: stringValue(entry.address),
        mnemonic: decrypted.mnemonic,
        hexSeed: decrypted.hexSeed,
      };
      await WalletEncryptionUtil.downloadWallet(account, data.filePassword);

      setExportSuccess(true);
      form.reset();
    } catch (error) {
      logger.error("Error exporting wallet file:", error);
      setExportError({ key: "settings:exportError" });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <>
      <SettingsRow
        icon={FileDown}
        tint="bg-teal-500/15 text-teal-400"
        title={t("settings:export")}
        subtitle={t("settings:exportHint")}
        right={
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              showPanel && "rotate-180",
            )}
          />
        }
        onClick={() => {
          setShowPanel((open) => !open);
        }}
        disabled={isExporting}
        ariaExpanded={showPanel}
        ariaControls="export-wallet-panel"
      />
      {showPanel && (
        <div id="export-wallet-panel" className="px-4 pb-4 pt-3">
          <Form {...form}>
            <form
              onSubmit={(event) => {
                void form
                  .handleSubmit(onSubmit)(event)
                  .catch((error: unknown) => {
                    logger.error("Error exporting wallet file:", error);
                    setExportError({ key: "settings:exportError" });
                  });
              }}
              className="space-y-4"
            >
              <p className="text-xs text-muted-foreground">
                <Trans
                  t={t}
                  i18nKey="settings:exportDescription"
                  components={{
                    account: activeAddress ? (
                      <QrlAddress address={activeAddress} revealable />
                    ) : (
                      <span />
                    ),
                  }}
                />
              </p>

              {pinLockout.isLocked && (
                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                  {t("settings:lockout", {
                    count: Math.ceil(pinLockout.remainingMs / 60000),
                  })}
                </div>
              )}
              {exportError && !pinLockout.isLocked && (
                <div
                  role="alert"
                  className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
                >
                  {t(exportError.key, { count: exportError.count })}
                </div>
              )}
              {exportSuccess && (
                <div
                  role="status"
                  className="rounded-md bg-success/15 p-3 text-sm text-success"
                >
                  {isInNativeApp()
                    ? t("settings:exportShared")
                    : t("settings:exportDownloaded")}
                </div>
              )}

              <FormField
                control={form.control}
                name="pin"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t("settings:walletPin")}</FormLabel>
                    <FormControl>
                      <PinInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder={t("settings:enterPin")}
                        error={settingsValidationMessage(
                          fieldState.error?.message,
                          t,
                        )}
                        disabled={isExporting || pinLockout.isLocked}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="filePassword"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t("settings:filePassword")}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        disabled={isExporting || pinLockout.isLocked}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t("settings:passwordHint")}
                    </FormDescription>
                    {fieldState.error && (
                      <p className="text-sm font-medium text-destructive">
                        {settingsValidationMessage(fieldState.error.message, t)}
                      </p>
                    )}
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmFilePassword"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t("settings:confirmPassword")}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        disabled={isExporting || pinLockout.isLocked}
                        {...field}
                      />
                    </FormControl>
                    {fieldState.error && (
                      <p className="text-sm font-medium text-destructive">
                        {settingsValidationMessage(fieldState.error.message, t)}
                      </p>
                    )}
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full"
                disabled={isExporting || pinLockout.isLocked}
              >
                <FileDown className="mr-2 h-4 w-4" />
                {isExporting ? t("settings:exporting") : t("settings:export")}
              </Button>
            </form>
          </Form>
        </div>
      )}
    </>
  );
});
