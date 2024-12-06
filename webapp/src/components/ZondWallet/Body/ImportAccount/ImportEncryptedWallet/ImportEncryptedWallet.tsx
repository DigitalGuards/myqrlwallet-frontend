import { Button } from "../../../../UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../UI/Card";
import { Input } from "../../../../UI/Input";
import { Label } from "../../../../UI/Label";
import { WalletEncryptionUtil, ExtendedWalletAccount } from "../../../../../utilities/walletEncryptionUtil";
import { useStore } from "../../../../../stores/store";
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

      const account = zondInstance?.accounts.seedToAccount(decryptedWallet.hexSeed);
      if (!account) {
        throw new Error("Failed to import account from wallet");
      }

      onWalletImported(account);
    } catch (error) {
      setError("password", {
        message: "Failed to decrypt wallet. Please check your password.",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Encrypted Wallet</CardTitle>
        <CardDescription>
          Select your encrypted wallet file and enter the password to decrypt it.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-8">
          <div className="space-y-2">
            <Label>Wallet File</Label>
            <Input
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="cursor-pointer"
            />
            {fileError && (
              <div className="text-sm font-medium text-destructive">
                {fileError}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              {...register("password")}
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
