import { onboardingMessage } from "@/i18n/onboardingMessage";
import { useTranslation } from "react-i18next";
import type { ImportedAccount } from "../importedAccount";
import { logger } from "@/utils/log";
import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardFooter } from "@/components/UI/Card";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/UI/Select";
import type { EncryptedKeystore, EncryptedWallet } from "@/utils/crypto";
import {
  MAX_WALLET_FILE_BYTES,
  MAX_WALLET_PASSWORD_LENGTH,
  WalletEncryptionUtil,
  decryptKeystoreAsync,
  getMnemonicFromHexSeed,
  looksLikeKeystoreBackup,
  parseKeystoreBackup,
  CryptoOperationError,
  CryptoErrorCode,
} from "@/utils/crypto";
import { useStore } from "@/stores/store";
import { Upload } from "lucide-react";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { z } from "zod";
import { maxUtf16Length } from "@/utils/zodLength";
import { zodResolver } from "@hookform/resolvers/zod";
import { isDesktop } from "@/desktop/bridge";
import {
  formatAddressFingerprint,
  formatAddressFingerprintsInText,
} from "@/utils/formatting";

const FormSchema = z.object({
  password: z
    .string()
    .min(1, "onboarding:passwordRequired")
    .superRefine(maxUtf16Length(MAX_WALLET_PASSWORD_LENGTH, "onboarding:passwordLong")),
});

type ImportEncryptedWalletProps = {
  onWalletImported: (account: ImportedAccount) => void;
};

// The two file formats this tab understands:
// - 'v2': this wallet's own export ({ encryptedData, salt, iv, ... },
//   PBKDF2-SHA256 + AES-256-GCM)
// - 'keystore': the browser extension's Settings > Data backup
//   (qrl-wallet-backup-*.json, argon2id + AES-256-GCM keystores)
type ParsedWalletFile =
  | { kind: "v2"; wallet: EncryptedWallet }
  | { kind: "keystore"; keystores: EncryptedKeystore[] };

export const ImportEncryptedWallet = ({
  onWalletImported,
}: ImportEncryptedWalletProps) => {
  const { t } = useTranslation(["onboarding", "common", "settings"]);
  const { qrlStore } = useStore();
  const { qrlInstance } = qrlStore;

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedWalletFile | null>(null);
  const [selectedKeystore, setSelectedKeystore] = useState("0");
  const [fileError, setFileError] = useState<string>("");
  const [isParsing, setIsParsing] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);

  const form = useForm({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      password: "",
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = form;

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_WALLET_FILE_BYTES) {
      setFileError("onboarding:fileLarge");
      setSelectedFile(null);
      setParsed(null);
      return;
    }
    if (file.type !== "application/json" && file.type !== "") {
      setFileError("onboarding:fileJson");
      setSelectedFile(null);
      setParsed(null);
      return;
    }
    setSelectedFile(file);
    setSelectedKeystore("0");
    setFileError("");
    // Submit is blocked while parsing so a fast submit cannot race the
    // awaited file read and decrypt a previously selected file.
    setIsParsing(true);
    setParsed(null);
    try {
      const content: unknown = JSON.parse(await file.text());
      if (looksLikeKeystoreBackup(content)) {
        setParsed({
          kind: "keystore",
          keystores: parseKeystoreBackup(content),
        });
        return;
      }
      try {
        setParsed({
          kind: "v2",
          wallet: WalletEncryptionUtil.parseEncryptedWallet(content),
        });
        return;
      } catch {
        // Fall through to the common invalid-format message below.
      }
      setParsed(null);
      setFileError("onboarding:fileInvalid");
    } catch (error) {
      setParsed(null);
      setFileError(
        error instanceof Error && error.name === "KeystoreFormatError"
          ? error.message
          : "onboarding:fileInvalid",
      );
    } finally {
      setIsParsing(false);
    }
  };

  const finishImport = (hexSeed: string, mnemonic: string) => {
    // Desktop: decrypting the file in-page is unavoidable (same exposure as
    // typing a mnemonic), but skip the in-renderer account derivation.
    // Forward the recovered secret on a placeholder account; PinSetup hands
    // it to the signer, which derives the address (mnemonic preferred,
    // hexSeed fallback when the file lacks one).
    if (isDesktop) {
      const account: ImportedAccount = {
        address: "",
        hexSeed,
        mnemonic,
      };
      onWalletImported(account);
      return;
    }

    const account: ImportedAccount | undefined =
      qrlInstance?.accounts.seedToAccount(hexSeed);
    if (!account) {
      throw new Error("Failed to import account from wallet");
    }

    account.hexSeed = hexSeed;
    if (mnemonic) {
      account.mnemonic = mnemonic;
    } else {
      logger.warn(
        "Mnemonic might be missing from decrypted wallet data. Proceeding with hexSeed only.",
      );
    }

    onWalletImported(account);
  };

  const onSubmit = async (formData: z.infer<typeof FormSchema>) => {
    if (isParsing || isDecrypting) return;
    if (!selectedFile || !parsed) {
      setFileError("onboarding:fileRequired");
      return;
    }

    if (parsed.kind === "keystore") {
      const index = Number(selectedKeystore);
      const keystore = parsed.keystores[index] ?? parsed.keystores[0];
      if (!keystore) {
        setFileError("onboarding:noKeystores");
        return;
      }
      setIsDecrypting(true);
      try {
        // Worker-side argon2id: seconds on the WASM path, longer on the
        // pure-JS fallback; the button shows a decrypting state meanwhile.
        const hexSeed = await decryptKeystoreAsync(keystore, formData.password);
        // Extension backups carry only the seed; re-derive the mnemonic so
        // PIN setup can store both representations (skip in the desktop
        // renderer, where the signer derives everything).
        const mnemonic = isDesktop ? "" : getMnemonicFromHexSeed(hexSeed);
        finishImport(hexSeed, mnemonic);
      } catch (error) {
        if (
          error instanceof CryptoOperationError &&
          error.code === CryptoErrorCode.INVALID_DATA
        ) {
          setFileError(error.message);
        } else {
          setError("password", {
            message: "onboarding:keystoreDecryptFailed",
          });
        }
      } finally {
        setIsDecrypting(false);
      }
      return;
    }

    setIsDecrypting(true);
    try {
      const decryptedWallet = await WalletEncryptionUtil.decryptWallet(
        parsed.wallet,
        formData.password,
      );
      finishImport(decryptedWallet.hexSeed, decryptedWallet.mnemonic);
    } catch (_error) {
      setError("password", {
        message: "onboarding:fileDecryptFailed",
      });
    } finally {
      setIsDecrypting(false);
    }
  };

  const isExtensionBackup = parsed?.kind === "keystore";
  const keystores = isExtensionBackup ? parsed.keystores : [];
  const activeKeystore = isExtensionBackup
    ? (keystores[Number(selectedKeystore)] ?? keystores[0])
    : undefined;

  return (
    <Card>
      <form
        onSubmit={(event) => {
          handleSubmit(onSubmit)(event).catch(() => {
            form.setError("password", {
              message: "onboarding:fileDecryptFailed",
            });
          });
        }}
      >
        <CardContent className="space-y-8 pt-6">
          <p className="text-sm text-muted-foreground">
            {t("onboarding:fileHelp")}
          </p>
          <div className="space-y-2">
            <Label className="text-foreground">
              {t("onboarding:walletFile")}
            </Label>
            <div className="flex flex-col items-center justify-center w-full">
              <label
                htmlFor="walletFile"
                className="flex min-w-0 w-full flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed cursor-pointer hover:bg-accent/50"
              >
                <div className="flex min-w-0 w-full flex-col items-center justify-center px-4 pt-5 pb-6">
                  <Upload className="w-8 h-8 mb-2 text-foreground" />
                  <p
                    className="mb-2 w-full truncate text-center text-sm text-foreground"
                    title={selectedFile?.name}
                    aria-label={
                      selectedFile
                        ? t("onboarding:selectedFile", {
                            name: selectedFile.name,
                          })
                        : undefined
                    }
                  >
                    {selectedFile
                      ? formatAddressFingerprintsInText(selectedFile.name)
                      : t("onboarding:importFile")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("onboarding:jsonOnly")}
                  </p>
                </div>
                <Input
                  id="walletFile"
                  type="file"
                  accept=".json"
                  onChange={(event) => {
                    handleFileChange(event).catch(() => {
                      setFileError("onboarding:fileInvalid");
                    });
                  }}
                  // Swapping files mid-decrypt would finish the import with
                  // the OLD file while the card shows the new one.
                  disabled={isDecrypting}
                  className="hidden"
                />
              </label>
            </div>
            {fileError && (
              <div className="text-sm font-medium text-destructive">
                {onboardingMessage(fileError, t)}
              </div>
            )}
          </div>

          {isExtensionBackup && keystores.length > 1 && (
            <div className="space-y-2">
              <Label className="text-foreground">
                {t("onboarding:accountToImport")}
              </Label>
              <Select
                value={selectedKeystore}
                onValueChange={setSelectedKeystore}
                disabled={isDecrypting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("onboarding:selectAccount")} />
                </SelectTrigger>
                <SelectContent>
                  {keystores.map((ks, i) => (
                    <SelectItem key={ks.id ?? i} value={String(i)}>
                      {ks.address
                        ? formatAddressFingerprint(ks.address)
                        : t("onboarding:accountNumber", { number: i + 1 })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("onboarding:backupAccounts", { count: keystores.length })}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="password" className="text-foreground">
              {t("onboarding:password")}
            </Label>
            <Input
              id="password"
              type="password"
              {...register("password")}
              className="text-foreground"
            />
            {isExtensionBackup && (
              <p className="text-xs text-muted-foreground">
                {t("onboarding:extensionPassword")}
              </p>
            )}
            {activeKeystore && activeKeystore.crypto.kdfparams.m > 262144 && (
              <p className="text-xs text-yellow-400">
                {t("onboarding:memoryWarning")}
              </p>
            )}
            {errors.password?.message && (
              <div className="text-sm font-medium text-destructive">
                {onboardingMessage(errors.password.message, t)}
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            type="submit"
            disabled={isDecrypting || isParsing}
          >
            <Upload className="mr-2 h-4 w-4" />
            {isDecrypting
              ? t("onboarding:decrypting")
              : t("onboarding:importWallet")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};
