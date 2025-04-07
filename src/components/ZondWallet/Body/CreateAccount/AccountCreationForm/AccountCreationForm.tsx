import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/UI/Form";
import { Input } from "@/components/UI/Input";
import { useStore } from "@/stores/store";
import { zodResolver } from "@hookform/resolvers/zod";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { Loader, Plus } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { WalletEncryptionUtil } from "@/utilities/walletEncryptionUtil";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import { Separator } from "@/components/UI/Separator";

const FormSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    reEnteredPassword: z
      .string()
      .min(8, "Password must be at least 8 characters"),
    pin: z.string().min(4, "PIN must be at least 4 digits").max(6, "PIN must be at most 6 digits"),
    reEnteredPin: z.string().min(4, "PIN must be at least 4 digits").max(6, "PIN must be at most 6 digits"),
  })
  .refine((fields) => fields.password === fields.reEnteredPassword, {
    message: "Passwords don't match",
    path: ["reEnteredPassword"],
  })
  .refine((fields) => fields.pin === fields.reEnteredPin, {
    message: "PINs don't match",
    path: ["reEnteredPin"],
  });

type AccountCreationFormProps = {
  onAccountCreated: (account: Web3BaseWalletAccount, password: string, pin: string) => void;
};

export const AccountCreationForm = observer(
  ({ onAccountCreated }: AccountCreationFormProps) => {
    const { zondStore } = useStore();
    const { zondInstance } = zondStore;

    const form = useForm<z.infer<typeof FormSchema>>({
      resolver: zodResolver(FormSchema),
      mode: "onChange",
      reValidateMode: "onSubmit",
      defaultValues: {
        password: "",
        reEnteredPassword: "",
        pin: "",
        reEnteredPin: "",
      },
    });
    const {
      handleSubmit,
      control,
      formState: { isSubmitting, isValid },
    } = form;

    async function onSubmit(formData: z.infer<typeof FormSchema>) {
      try {
        const userPassword = formData.password;
        const userPin = formData.pin;
        
        // Validate password strength
        if (!WalletEncryptionUtil.validatePassword(userPassword)) {
          control.setError("password", {
            message: "Password must be at least 8 characters and contain uppercase, lowercase, numbers, and special characters",
          });
          return;
        }

        // Validate PIN format
        if (!WalletEncryptionUtil.validatePin(userPin)) {
          control.setError("pin", {
            message: "PIN must be 4-6 digits",
          });
          return;
        }

        const newAccount = await zondInstance?.accounts.create();
        if (!newAccount) {
          throw new Error("Failed to create account");
        }
        onAccountCreated(newAccount, userPassword, userPin);
      } catch (error) {
        control.setError("reEnteredPassword", {
          message: `${error} There was an error while creating the account`,
        });
      }
    }

    return (
      <Form {...form}>
        <form className="w-full" onSubmit={handleSubmit(onSubmit)}>
          <Card>
            <CardHeader>
              <CardTitle>Create new account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-8">
              <div>
                <h3 className="text-lg font-medium mb-4">Wallet Password</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  This password will be used to encrypt your wallet backup files. It should be strong and secure.
                </p>
                <div className="space-y-4">
                  <FormField
                    control={control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input
                            disabled={isSubmitting}
                            placeholder="Password"
                            type="password"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>Enter a strong password</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name="reEnteredPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input
                            {...field}
                            disabled={isSubmitting}
                            placeholder="Re-enter the password"
                            type="password"
                          />
                        </FormControl>
                        <FormDescription>Re-enter the password</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
              
              <Separator />
              
              <div>
                <h3 className="text-lg font-medium mb-4">Transaction PIN</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  This PIN will be used for daily transactions. You'll enter this PIN instead of your seed phrase when sending funds. This pin is used to decrypt your seed phrase when it's imported. Which is also erased after 15 minutes which is the default inactivity timer setting. It is still recommended to press the "Logout" button when you're done using the wallet.
                </p>
                <div className="space-y-4">
                  <FormField
                    control={control}
                    name="pin"
                    render={({ field }) => (
                      <PinInput
                        length={6}
                        placeholder="Enter PIN (4-6 digits)"
                        value={field.value}
                        onChange={field.onChange}
                        disabled={isSubmitting}
                        description="Enter a 4-6 digit PIN"
                        error={form.formState.errors.pin?.message}
                      />
                    )}
                  />
                  <FormField
                    control={control}
                    name="reEnteredPin"
                    render={({ field }) => (
                      <PinInput
                        length={6}
                        placeholder="Re-enter PIN"
                        value={field.value}
                        onChange={field.onChange}
                        disabled={isSubmitting}
                        description="Re-enter your PIN"
                        error={form.formState.errors.reEnteredPin?.message}
                      />
                    )}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button
                disabled={isSubmitting || !isValid}
                className="w-full"
                type="submit"
              >
                {isSubmitting ? (
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Create account
              </Button>
            </CardFooter>
          </Card>
        </form>
      </Form>
    );
  }
);
