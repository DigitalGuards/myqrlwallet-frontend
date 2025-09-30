import { Button } from "../../../../UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../UI/Card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "../../../../UI/Form";
import { Input } from "../../../../UI/Input";
import { useStore } from "../../../../../stores/store";
import { zodResolver } from "@hookform/resolvers/zod";
import { Download, Loader } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { getHexSeedFromMnemonic } from "../../../../../functions/getHexSeedFromMnemonic";
import { ExtendedWalletAccount } from "../../../../../utilities/walletEncryptionUtil";

const FormSchema = z.object({
  mnemonicPhrases: z.string().min(1, "Mnemonic phrases are required"),
});

type ImportAccountFormProps = {
  onAccountImported: (account: ExtendedWalletAccount) => void;
};

export const ImportAccountForm = ({ onAccountImported }: ImportAccountFormProps) => {
  const { zondStore } = useStore();
  const { zondInstance } = zondStore;

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      mnemonicPhrases: "",
    },
  });

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = form;

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    try {
      const hexSeed = await getHexSeedFromMnemonic(formData.mnemonicPhrases);
      const account = zondInstance?.accounts.seedToAccount(hexSeed) as ExtendedWalletAccount;
      
      if (!account) {
        throw new Error("Failed to create account from mnemonic");
      }

      // Add mnemonic and hexSeed to the account
      account.mnemonic = formData.mnemonicPhrases;
      account.hexSeed = hexSeed;

      onAccountImported(account);
    } catch (error) {
      form.setError("mnemonicPhrases", {
        message: "Invalid mnemonic phrases",
      });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <Card className="border-l-4 border-l-blue-accent">
          <CardHeader className="bg-gradient-to-r from-blue-accent/5 to-transparent">
            <CardTitle className="text-2xl font-bold">Import with Mnemonic</CardTitle>
            <CardDescription>
              Enter your mnemonic phrase to restore your wallet
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <FormField
              control={control}
              name="mnemonicPhrases"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Enter your mnemonic phrases"
                      autoComplete="off"
                    />
                  </FormControl>
                  <FormDescription>
                    Enter the mnemonic phrases from your wallet backup
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
