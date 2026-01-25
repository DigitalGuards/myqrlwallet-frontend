import { useState, useEffect } from "react";
import { ShinyButton } from "@/components/UI/ShinyButton";
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
import { encryptSeedAsync, decryptSeedAsync, getMnemonicFromHexSeed } from "@/utils/crypto";
import { StorageUtil } from "@/utils/storage";
import { isInNativeApp, notifySeedStored } from "@/utils/nativeApp";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import { Separator } from "@/components/UI/Separator";

// Password must match WalletEncryptionUtil.validatePassword() requirements
const passwordValidation = z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/\d/, "Password must contain at least one number")
  .regex(/[!@#$%^&*(),.?":{}|<>]/, "Password must contain at least one special character (!@#$%^&*(),.?\":{}|<>)");

const pinValidation = z.string()
  .min(4, "PIN must be at least 4 digits")
  .max(6, "PIN must be at most 6 digits")
  .regex(/^\d+$/, "PIN must contain only digits");

// Base form values type - reEnteredPin is always present but may be empty
type FormValues = {
  password: string;
  reEnteredPassword: string;
  pin: string;
  reEnteredPin: string;
};

// Schema for new users (no existing seeds) - requires PIN confirmation
const NewUserSchema = z.object({
  password: passwordValidation,
  reEnteredPassword: z.string().min(1, "Please re-enter your password"),
  pin: pinValidation,
  reEnteredPin: pinValidation,
}).refine((data) => data.password === data.reEnteredPassword, {
  message: "Passwords don't match",
  path: ["reEnteredPassword"],
}).refine((data) => data.pin === data.reEnteredPin, {
  message: "PINs don't match",
  path: ["reEnteredPin"],
});

// Schema for existing users - no PIN confirmation needed
const ExistingUserSchema = z.object({
  password: passwordValidation,
  reEnteredPassword: z.string().min(1, "Please re-enter your password"),
  pin: pinValidation,
  reEnteredPin: z.string(), // Present but not validated
}).refine((data) => data.password === data.reEnteredPassword, {
  message: "Passwords don't match",
  path: ["reEnteredPassword"],
});

type AccountCreationFormProps = {
  onAccountCreated: (
    account: Web3BaseWalletAccount,
    password: string,
    mnemonic: string,
    hexSeed: string
  ) => void;
};

type InnerFormProps = {
  onAccountCreated: (
    account: Web3BaseWalletAccount,
    password: string,
    mnemonic: string,
    hexSeed: string
  ) => void;
  hasExistingSeeds: boolean;
  existingSeeds: { address: string; encryptedSeed: string }[];
  blockchain: string;
};

/**
 * Inner form component - only rendered after we know if user has existing seeds.
 * This ensures the correct schema is used from the start.
 */
const InnerForm = observer(({ onAccountCreated, hasExistingSeeds, existingSeeds, blockchain }: InnerFormProps) => {
  const { zondStore } = useStore();
  const { zondInstance } = zondStore;
  const [isEncrypting, setIsEncrypting] = useState(false);

  // Select schema based on whether user has existing seeds
  const schema = hasExistingSeeds ? ExistingUserSchema : NewUserSchema;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
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
    formState: { isSubmitting, isValid, errors },
    setError,
  } = form;

  async function onSubmit(formData: FormValues) {
    try {
      const userPassword = formData.password;
      const userPin = formData.pin;

      // If existing seeds exist, verify PIN by attempting to decrypt one
      if (hasExistingSeeds && existingSeeds.length > 0) {
        try {
          await decryptSeedAsync(existingSeeds[0].encryptedSeed, userPin);
        } catch {
          setError("pin", {
            message: "Incorrect PIN. Please enter your existing wallet PIN.",
          });
          return;
        }
      }

      // Create the account
      const newAccount = await zondInstance?.accounts.create();
      if (!newAccount || !newAccount.seed) {
        throw new Error("Failed to create account");
      }

      // Get mnemonic from hex seed
      const hexSeed = newAccount.seed;
      const mnemonic = getMnemonicFromHexSeed(hexSeed);
      if (!mnemonic) {
        throw new Error("Failed to generate mnemonic");
      }

      // Encrypt the seed with PIN (runs in Web Worker)
      setIsEncrypting(true);
      const encryptedSeed = await encryptSeedAsync(mnemonic, hexSeed, userPin);

      // Store the encrypted seed in localStorage
      await StorageUtil.storeEncryptedSeed(blockchain, newAccount.address, encryptedSeed);

      // Notify native app if running in native context
      if (isInNativeApp()) {
        notifySeedStored({
          address: newAccount.address,
          encryptedSeed,
          blockchain,
        });
      }

      setIsEncrypting(false);
      onAccountCreated(newAccount, userPassword, mnemonic, hexSeed);
    } catch (error) {
      setIsEncrypting(false);
      setError("root", {
        message: `${error} There was an error while creating the account`,
      });
    }
  }

  const isProcessing = isSubmitting || isEncrypting;
  const buttonText = isEncrypting
    ? "Encrypting..."
    : isSubmitting
    ? "Creating account..."
    : "Create account";

  return (
    <Form {...form}>
      <form className="w-full" onSubmit={handleSubmit(onSubmit)}>
        <Card className="border-l-4 border-l-blue-accent">
          <CardHeader className="bg-gradient-to-r from-blue-accent/5 to-transparent">
            <CardTitle className="text-2xl font-bold">Create new account</CardTitle>
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
                      <FormDescription>
                        Must include uppercase, lowercase, number, and special character
                      </FormDescription>
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
                      error={errors.pin?.message}
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
                        value={field.value}
                        onChange={field.onChange}
                        disabled={isSubmitting}
                        description="Re-enter your PIN"
                        error={errors.reEnteredPin?.message}
                      />
                    )}
                  />
                )}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex-col gap-4">
            {errors.root && (
              <p className="text-sm text-destructive w-full">
                {errors.root.message}
              </p>
            )}
            <ShinyButton
              disabled={!isValid || isProcessing}
              processing={isProcessing}
              className="w-full"
              type="submit"
            >
              <Plus className="mr-2 h-4 w-4" />
              {buttonText}
            </ShinyButton>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
});

/**
 * Wrapper component that loads seed data before rendering the form.
 * This ensures the form schema is determined correctly.
 */
export const AccountCreationForm = observer(
  ({ onAccountCreated }: AccountCreationFormProps) => {
    const { zondStore } = useStore();
    const { zondConnection } = zondStore;
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

    // Render the form once we know if user has existing seeds
    return (
      <InnerForm
        onAccountCreated={onAccountCreated}
        hasExistingSeeds={hasExistingSeeds}
        existingSeeds={existingSeeds}
        blockchain={blockchain}
      />
    );
  }
);
