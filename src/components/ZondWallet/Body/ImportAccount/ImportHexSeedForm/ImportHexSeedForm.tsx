import { useStore } from "@/stores/store";
import { ExtendedWalletAccount } from "@/utilities/walletEncryptionUtil";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/UI/Card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormMessage } from "@/components/UI/Form";
import { Input } from "@/components/UI/Input";
import { Button } from "@/components/UI/Button";
import { Download, Loader } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { getMnemonicFromHexSeed } from "@/functions/getMnemonicFromHexSeed";

const FormSchema = z.object({
  hexSeed: z
    .string()
    .min(1, "Hex seed is required")
    .regex(/^0x[0-9a-fA-F]+$/, "Invalid hex seed format. Must start with '0x' followed by hex characters"),
});

interface ImportHexSeedFormProps {
  onAccountImported: (account: ExtendedWalletAccount) => void;
}

export const ImportHexSeedForm = ({ onAccountImported }: ImportHexSeedFormProps) => {
  const { zondStore } = useStore();
  const { zondInstance } = zondStore;

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      hexSeed: "",
    },
  });

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = form;

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    try {
      const account = zondInstance?.accounts.seedToAccount(formData.hexSeed) as ExtendedWalletAccount;
      
      if (!account) {
        throw new Error("Failed to create account from hex seed");
      }

      // Retrieve mnemonic from hex seed
      const mnemonic = getMnemonicFromHexSeed(formData.hexSeed);
      if (!mnemonic) {
        // Handle cases where mnemonic generation might fail
        console.error("Failed to derive mnemonic from hex seed.");
        form.setError("hexSeed", {
          message: "Failed to derive mnemonic from hex seed",
        });
        return; // Stop execution if mnemonic can't be derived
      }

      // Add hexSeed and mnemonic to the account object
      account.hexSeed = formData.hexSeed;
      account.mnemonic = mnemonic;

      onAccountImported(account);
    } catch (_error) {
      form.setError("hexSeed", {
        message: "Invalid hex seed",
      });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <Card className="border-l-4 border-l-blue-accent">
          <CardHeader className="bg-gradient-to-r from-blue-accent/5 to-transparent">
            <CardTitle className="text-2xl font-bold">Import with Hex Seed</CardTitle>
            <CardDescription>
              Enter your hexadecimal seed to restore your wallet
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <FormField
              control={control}
              name="hexSeed"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Enter your hex seed (0x...)"
                      autoComplete="off"
                    />
                  </FormControl>
                  <FormDescription>
                    Enter the hex seed from your wallet backup
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button className="w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Import Account
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
};
