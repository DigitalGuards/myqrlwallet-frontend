import { useState, useEffect } from "react";
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
import { WalletEncryptionUtil } from "@/utils/crypto";
import { StorageUtil } from "@/utils/storage";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import { Separator } from "@/components/UI/Separator";
import { isInNativeApp } from "@/utils/nativeApp";

// Base validation rules
const passwordValidation = z.string().min(8, "Password must be at least 8 characters");
const pinValidation = z.string()
  .min(4, "PIN must be at least 4 digits")
  .max(6, "PIN must be at most 6 digits")
  .regex(/^\d+$/, "PIN must contain only digits");

// Unified schema with password confirmation always required
const FormSchema = z.object({
  password: passwordValidation,
  reEnteredPassword: passwordValidation,
  pin: pinValidation,
  reEnteredPin: z.string(),
}).refine((data) => data.password === data.reEnteredPassword, {
  message: "Passwords don't match",
  path: ["reEnteredPassword"],
});

type FormValues = z.infer<typeof FormSchema>;

// Create schema with PIN confirmation for new users
const createSchema = (requirePinConfirmation: boolean) => {
  if (requirePinConfirmation) {
    return FormSchema.refine((data) => data.pin === data.reEnteredPin, {
      message: "PINs don't match",
      path: ["reEnteredPin"],
    });
  }
  return FormSchema;
};

type AccountCreationFormProps = {
  onAccountCreated: (account: Web3BaseWalletAccount, password: string, pin: string) => void;
};

export const AccountCreationForm = observer(
  ({ onAccountCreated }: AccountCreationFormProps) => {
    const { zondStore } = useStore();
    const { zondInstance, zondConnection } = zondStore;
    const { blockchain } = zondConnection;
    const [hasExistingSeeds, setHasExistingSeeds] = useState<boolean | null>(null);
    const [existingSeeds, setExistingSeeds] = useState<{ address: string; encryptedSeed: string }[]>([]);

    // Check for existing encrypted seeds on mount
    useEffect(() => {
      const checkExistingSeeds = async () => {
        const seeds = await StorageUtil.getAllEncryptedSeeds(blockchain);
        setHasExistingSeeds(seeds.length > 0);
        setExistingSeeds(seeds);
      };
      checkExistingSeeds();
    }, [blockchain]);

    // Use dynamic schema - require PIN confirmation only for new users
    const form = useForm<FormValues>({
      resolver: zodResolver(createSchema(!hasExistingSeeds)),
      mode: "onChange",
      reValidateMode: "onChange",
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
      setError,
    } = form;

    async function onSubmit(formData: FormValues) {
      try {
        const userPassword = formData.password;
        const userPin = formData.pin;

        // Validate password strength (more complex than basic zod validation)
        if (!WalletEncryptionUtil.validatePassword(userPassword)) {
          setError("password", {
            message: "Password must be at least 8 characters and contain uppercase, lowercase, numbers, and special characters",
          });
          return;
        }

        // PIN format and matching validation is handled by zod schema

        // If existing seeds exist, verify PIN by attempting to decrypt one
        if (hasExistingSeeds && existingSeeds.length > 0) {
          try {
            WalletEncryptionUtil.decryptSeedWithPin(existingSeeds[0].encryptedSeed, userPin);
          } catch {
            setError("pin", {
              message: "Incorrect PIN. Please enter your existing wallet PIN.",
            });
            return;
          }
        }

        const newAccount = await zondInstance?.accounts.create();
        if (!newAccount) {
          throw new Error("Failed to create account");
        }
        onAccountCreated(newAccount, userPassword, userPin);
      } catch (error) {
        setError("root", {
          message: `${error} There was an error while creating the account`,
        });
      }
    }

    // Show loading state while checking for existing seeds
    if (hasExistingSeeds === null) {
      return (
        <Card>
          <CardContent className="flex items-center justify-center py-8">
            <Loader className="h-6 w-6 animate-spin" />
          </CardContent>
        </Card>
      );
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
                <h3 className="text-lg font-medium mb-4">
                  {hasExistingSeeds ? "Your Existing PIN" : "Transaction PIN"}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {hasExistingSeeds
                    ? "Enter your existing PIN to add this wallet. All wallets use the same PIN for security."
                    : isInNativeApp()
                    ? "This PIN will be used for daily transactions and to enable security features like Device Login. You'll enter this PIN instead of your seed phrase when sending funds. Your wallet is secured by Device Login and automatically locks when you switch apps."
                    : "This PIN will be used for daily transactions. You'll enter this PIN instead of your seed phrase when sending funds. Your encrypted seed is erased after 15 minutes of inactivity (adjustable in Settings). Press \"Logout\" when done for extra security."}
                </p>
                <div className="space-y-4">
                  <FormField
                    control={control}
                    name="pin"
                    render={({ field }) => (
                      <PinInput
                        length={6}
                        placeholder={hasExistingSeeds ? "Your existing PIN" : "Enter PIN (4-6 digits)"}
                        value={field.value}
                        onChange={field.onChange}
                        disabled={isSubmitting}
                        description={hasExistingSeeds ? "(All wallets use the same PIN)" : "Enter a 4-6 digit PIN"}
                        error={form.formState.errors.pin?.message}
                      />
                    )}
                  />
                  {!hasExistingSeeds && (
                    <FormField
                      control={control}
                      name="reEnteredPin"
                      render={({ field }) => (
                        <PinInput
                          length={6}
                          placeholder="Re-enter PIN"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          disabled={isSubmitting}
                          description="Re-enter your PIN"
                          error={form.formState.errors.reEnteredPin?.message}
                        />
                      )}
                    />
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex-col gap-4">
              {form.formState.errors.root && (
                <p className="text-sm text-destructive w-full">
                  {form.formState.errors.root.message}
                </p>
              )}
              <Button
                disabled={isSubmitting || !isValid || hasExistingSeeds === null}
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
