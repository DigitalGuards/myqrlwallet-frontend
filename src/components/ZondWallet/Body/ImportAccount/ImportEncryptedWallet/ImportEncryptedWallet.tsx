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
import { WalletEncryptionUtil, ExtendedWalletAccount } from "@/utilities/walletEncryptionUtil";
import { useStore } from "@/stores/store";
import { Upload } from "lucide-react";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const FormSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

type ImportEncryptedWalletProps = {
  onWalletImported: (account: ExtendedWalletAccount) => void;
};

export const ImportEncryptedWallet = ({
  onWalletImported,
}: ImportEncryptedWalletProps) => {
  const { zondStore } = useStore();
  const { zondInstance } = zondStore;

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>("");

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      password: "",
    },
  });

  const { register, handleSubmit, formState: { errors }, setError } = form;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type !== "application/json") {
        setFileError("Please select a valid JSON wallet file");
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
      setFileError("");
    }
  };

  const onSubmit = async (formData: z.infer<typeof FormSchema>) => {
    try {
      if (!selectedFile) {
        setFileError("Please select a wallet file");
        return;
      }

      const fileContent = await selectedFile.text();
      const encryptedWallet = JSON.parse(fileContent);
      
      // Validate wallet file format
      if (!encryptedWallet.encryptedData || !encryptedWallet.salt || !encryptedWallet.iv) {
        setFileError("Invalid wallet file format");
        return;
      }

      const decryptedWallet = WalletEncryptionUtil.decryptWallet(
        encryptedWallet,
        formData.password
      );

      const account = zondInstance?.accounts.seedToAccount(decryptedWallet.hexSeed) as ExtendedWalletAccount;
      if (!account) {
        throw new Error("Failed to import account from wallet");
      }

      // Add hexSeed and mnemonic from the decrypted data to the account object
      if (decryptedWallet.hexSeed && decryptedWallet.mnemonic) {
        account.hexSeed = decryptedWallet.hexSeed;
        account.mnemonic = decryptedWallet.mnemonic;
      } else {
        // Handle potential case where mnemonic might be missing, though unlikely if decryption worked
        account.hexSeed = decryptedWallet.hexSeed;
        console.warn("Mnemonic might be missing from decrypted wallet data. Proceeding with hexSeed only.");
      }

      onWalletImported(account);
    } catch (error) {
      setError("password", {
        message: "Failed to decrypt wallet. Please check your password.",
      });
    }
  };

  return (
    <Card className="border-l-4 border-l-blue-accent">
      <CardHeader className="bg-gradient-to-r from-blue-accent/5 to-transparent">
        <CardTitle className="text-2xl font-bold">Import Encrypted Wallet</CardTitle>
        <CardDescription className="text-muted-foreground">
          Select your encrypted wallet file and enter the password to decrypt it.
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
          <div className="space-y-2">
            <Label htmlFor="password" className="text-foreground">Password</Label>
            <Input
              id="password"
              type="password"
              {...register("password")}
              className="text-foreground"
            />
            {errors.password?.message && (
              <div className="text-sm font-medium text-destructive">
                {errors.password.message}
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Button className="w-full" type="submit">
            <Upload className="mr-2 h-4 w-4" />
            Import Wallet
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};
