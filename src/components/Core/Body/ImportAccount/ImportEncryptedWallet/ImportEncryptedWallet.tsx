import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/UI/Card";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/UI/Select";
import type { EncryptedKeystore, ExtendedWalletAccount } from "@/utils/crypto";
import {
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
import { zodResolver } from "@hookform/resolvers/zod";
import { isDesktop } from "@/desktop/bridge";

const FormSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

type ImportEncryptedWalletProps = {
  onWalletImported: (account: ExtendedWalletAccount) => void;
};

// The two file formats this tab understands:
// - 'v2': this wallet's own export ({ encryptedData, salt, iv, ... },
//   PBKDF2-SHA256 + AES-256-GCM)
// - 'keystore': the browser extension's Settings > Data backup
//   (qrl-wallet-backup-*.json, argon2id + AES-256-GCM keystores)
type ParsedWalletFile =
  | { kind: "v2"; wallet: { encryptedData: string; salt: string; iv: string } }
  | { kind: "keystore"; keystores: EncryptedKeystore[] };

function shortAddress(address: string | undefined, index: number): string {
  if (!address || address.length < 12) return `Account ${index + 1}`;
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}

export const ImportEncryptedWallet = ({
  onWalletImported,
}: ImportEncryptedWalletProps) => {
  const { qrlStore } = useStore();
  const { qrlInstance } = qrlStore;

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedWalletFile | null>(null);
  const [selectedKeystore, setSelectedKeystore] = useState("0");
  const [fileError, setFileError] = useState<string>("");
  const [isDecrypting, setIsDecrypting] = useState(false);

  const form = useForm({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      password: "",
    },
  });

  const { register, handleSubmit, formState: { errors }, setError } = form;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/json") {
      setFileError("Please select a valid JSON wallet file");
      setSelectedFile(null);
      setParsed(null);
      return;
    }
    setSelectedFile(file);
    setSelectedKeystore("0");
    setFileError("");
    try {
      const content: unknown = JSON.parse(await file.text());
      if (looksLikeKeystoreBackup(content)) {
        setParsed({ kind: "keystore", keystores: parseKeystoreBackup(content) });
        return;
      }
      if (
        content &&
        typeof content === "object" &&
        typeof (content as Record<string, unknown>)["encryptedData"] === "string" &&
        typeof (content as Record<string, unknown>)["salt"] === "string" &&
        typeof (content as Record<string, unknown>)["iv"] === "string"
      ) {
        setParsed({
          kind: "v2",
          wallet: content as { encryptedData: string; salt: string; iv: string },
        });
        return;
      }
      setParsed(null);
      setFileError("Invalid wallet file format");
    } catch (error) {
      setParsed(null);
      setFileError(
        error instanceof Error && error.name === "KeystoreFormatError"
          ? error.message
          : "Invalid wallet file format",
      );
    }
  };

  const finishImport = (hexSeed: string, mnemonic: string) => {
    // Desktop: decrypting the file in-page is unavoidable (same exposure as
    // typing a mnemonic), but skip the in-renderer account derivation.
    // Forward the recovered secret on a placeholder account; PinSetup hands
    // it to the signer, which derives the address (mnemonic preferred,
    // hexSeed fallback when the file lacks one).
    if (isDesktop) {
      const account = {
        address: "",
        hexSeed,
        mnemonic,
      } as ExtendedWalletAccount;
      onWalletImported(account);
      return;
    }

    const account = qrlInstance?.accounts.seedToAccount(hexSeed) as ExtendedWalletAccount;
    if (!account) {
      throw new Error("Failed to import account from wallet");
    }

    account.hexSeed = hexSeed;
    if (mnemonic) {
      account.mnemonic = mnemonic;
    } else {
      console.warn("Mnemonic might be missing from decrypted wallet data. Proceeding with hexSeed only.");
    }

    onWalletImported(account);
  };

  const onSubmit = async (formData: z.infer<typeof FormSchema>) => {
    if (!selectedFile || !parsed) {
      setFileError("Please select a wallet file");
      return;
    }

    if (parsed.kind === "keystore") {
      const index = Number(selectedKeystore);
      const keystore = parsed.keystores[index] ?? parsed.keystores[0];
      if (!keystore) {
        setFileError("The backup file contains no keystores.");
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
            message:
              "Could not decrypt the wallet file. Check the password and try again. For extension backups this is the extension's unlock password.",
          });
        }
      } finally {
        setIsDecrypting(false);
      }
      return;
    }

    try {
      const decryptedWallet = await WalletEncryptionUtil.decryptWallet(
        {
          ...parsed.wallet,
          address: "",
          version: "",
          timestamp: 0,
        },
        formData.password
      );
      finishImport(decryptedWallet.hexSeed, decryptedWallet.mnemonic);
    } catch (_error) {
      setError("password", {
        message: "Failed to decrypt wallet. Please check your password.",
      });
    }
  };

  const isExtensionBackup = parsed?.kind === "keystore";
  const keystores = isExtensionBackup ? parsed.keystores : [];

  return (
    <Card >
      <CardHeader>
        <CardTitle className="text-2xl font-bold">Import Encrypted Wallet</CardTitle>
        <CardDescription className="text-muted-foreground">
          Select an encrypted wallet file from this wallet or a backup exported
          by the MyQRLWallet browser extension, then enter its password.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-8">
          <div className="space-y-2">
            <Label className="text-foreground">Wallet File</Label>
            <div className="flex flex-col items-center justify-center w-full">
              <label
                htmlFor="walletFile"
                className="flex flex-col items-center justify-center w-full border-2 border-dashed rounded-lg cursor-pointer hover:bg-accent/50"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-8 h-8 mb-2 text-foreground" />
                  <p className="mb-2 text-sm text-foreground">
                    {selectedFile ? selectedFile.name : "Click to import wallet file"}
                  </p>
                  <p className="text-xs text-muted-foreground">JSON files only</p>
                </div>
                <Input
                  id="walletFile"
                  type="file"
                  accept=".json"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>
            {fileError && (
              <div className="text-sm font-medium text-destructive">
                {fileError}
              </div>
            )}
          </div>

          {isExtensionBackup && keystores.length > 1 && (
            <div className="space-y-2">
              <Label className="text-foreground">Account to import</Label>
              <Select value={selectedKeystore} onValueChange={setSelectedKeystore}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {keystores.map((ks, i) => (
                    <SelectItem key={ks.id ?? i} value={String(i)}>
                      {shortAddress(ks.address, i)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                This backup contains {keystores.length} accounts. Import them one
                at a time; run the import again for the others.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="password" className="text-foreground">Password</Label>
            <Input
              id="password"
              type="password"
              {...register("password")}
              className="text-foreground"
            />
            {isExtensionBackup && (
              <p className="text-xs text-muted-foreground">
                Extension backups are encrypted with the extension's unlock
                password.
              </p>
            )}
            {errors.password?.message && (
              <div className="text-sm font-medium text-destructive">
                {errors.password.message}
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Button className="w-full" type="submit" disabled={isDecrypting}>
            <Upload className="mr-2 h-4 w-4" />
            {isDecrypting ? "Decrypting..." : "Import Wallet"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};
