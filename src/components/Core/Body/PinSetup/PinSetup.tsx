import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../UI/Card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "../../../UI/Form";
import { Input } from "../../../UI/Input";
import { PinInput } from "../../../UI/PinInput/PinInput";
import { ShinyButton } from "../../../UI/ShinyButton";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { encryptSeedAsync, decryptSeedAsync, CryptoOperationError, CryptoErrorCode } from "@/utils/crypto";
import { StorageUtil } from "@/utils/storage";
import { useStore } from "../../../../stores/store";
import { isInNativeApp, notifySeedStored } from "@/utils/nativeApp";
import { isDesktop, desktopSigner } from "@/desktop/bridge";

// Password must match the signer's policy; same regex the create form uses.
const passwordValidation = z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/\d/, "Password must contain at least one number")
  .regex(/[!@#$%^&*(),.?":{}|<>]/, "Password must contain at least one special character (!@#$%^&*(),.?\":{}|<>)");

// Base PIN validation
const pinValidation = z.string()
  .min(4, "PIN must be at least 4 digits")
  .max(6, "PIN must be at most 6 digits")
  .regex(/^\d+$/, "PIN must contain only digits");

// Unified schema - reEnteredPin validation handled conditionally
const FormSchema = z.object({
  pin: pinValidation,
  reEnteredPin: z.string().optional(),
});

type FormValues = z.infer<typeof FormSchema>;

// Create schema with PIN confirmation for new users
const createSchema = (requireConfirmation: boolean) => {
  if (requireConfirmation) {
    return FormSchema.extend({
      reEnteredPin: pinValidation,
    }).refine((data) => data.pin === data.reEnteredPin, {
      message: "PINs don't match",
      path: ["reEnteredPin"],
    });
  }
  return FormSchema;
};

type PinSetupProps = {
  accountAddress: string;
  mnemonic: string;
  hexSeed: string;
  // On desktop the signer provisions the wallet and returns the address, which
  // is passed back so the caller can set it active.
  onPinSetupComplete: (provisionedAddress?: string) => void;
};

export const PinSetup = ({
  accountAddress,
  mnemonic,
  hexSeed,
  onPinSetupComplete,
}: PinSetupProps) => {
  // Desktop provisioning chokepoint: collect a PASSWORD (not a PIN) and import
  // the wallet via the signer. No seed material is encrypted or stored in the
  // renderer (no encryptSeedAsync / storeEncryptedSeed).
  if (isDesktop) {
    return (
      <DesktopPasswordSetup
        mnemonic={mnemonic}
        onPinSetupComplete={onPinSetupComplete}
      />
    );
  }
  return (
    <WebPinSetup
      accountAddress={accountAddress}
      mnemonic={mnemonic}
      hexSeed={hexSeed}
      onPinSetupComplete={onPinSetupComplete}
    />
  );
};

type DesktopPasswordValues = {
  password: string;
  reEnteredPassword: string;
};

const DesktopPasswordSchema = z.object({
  password: passwordValidation,
  reEnteredPassword: z.string().min(1, "Please re-enter your password"),
}).refine((data) => data.password === data.reEnteredPassword, {
  message: "Passwords don't match",
  path: ["reEnteredPassword"],
});

const DesktopPasswordSetup = ({
  mnemonic,
  onPinSetupComplete,
}: {
  mnemonic: string;
  onPinSetupComplete: (provisionedAddress?: string) => void;
}) => {
  const [isProvisioning, setIsProvisioning] = useState(false);
  const form = useForm<DesktopPasswordValues>({
    resolver: zodResolver(DesktopPasswordSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: { password: "", reEnteredPassword: "" },
  });
  const {
    handleSubmit,
    control,
    formState: { isSubmitting, isValid },
    setError,
  } = form;

  async function onSubmit(data: DesktopPasswordValues) {
    setIsProvisioning(true);
    try {
      const status = await desktopSigner.importWallet(mnemonic, data.password);
      setIsProvisioning(false);
      onPinSetupComplete(status.address);
    } catch (error) {
      setIsProvisioning(false);
      setError("password", {
        message: `${error instanceof Error ? error.message : String(error)} There was an error importing your wallet`,
      });
    }
  }

  return (
    <Form {...form}>
      <form className="w-full" onSubmit={handleSubmit(onSubmit)}>
        <Card className="border-l-4 border-l-orange-500">
          <CardHeader className="bg-gradient-to-r from-orange-500/5 to-transparent">
            <CardTitle className="text-2xl font-bold">Set Wallet Password</CardTitle>
            <CardDescription>
              This password unlocks your wallet on this device. The signer
              encrypts your seed with it; it never leaves your machine.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={isSubmitting || isProvisioning}
                      placeholder="Password"
                      type="password"
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
                      disabled={isSubmitting || isProvisioning}
                      placeholder="Re-enter the password"
                      type="password"
                    />
                  </FormControl>
                  <FormDescription>Re-enter the password</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <ShinyButton
              disabled={isSubmitting || !isValid || isProvisioning}
              processing={isProvisioning}
              className="w-full"
              type="submit"
            >
              {isProvisioning ? "Importing..." : "Import Wallet"}
            </ShinyButton>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
};

const WebPinSetup = ({
  accountAddress,
  mnemonic,
  hexSeed,
  onPinSetupComplete,
}: PinSetupProps) => {
  const { qrlStore } = useStore();
  const { qrlConnection } = qrlStore;
  const { blockchain } = qrlConnection;
  const [isStoringPin, setIsStoringPin] = useState(false);
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
      setIsStoringPin(true);
      const userPin = formData.pin;

      // PIN format and matching validation is handled by zod schema

      // If existing seeds exist, verify PIN by attempting to decrypt one
      // Uses Web Worker to avoid blocking UI during PBKDF2
      if (hasExistingSeeds && existingSeeds.length > 0) {
        try {
          // length > 0 is checked above; `?? ''` only satisfies the index
          // checker and would route an (impossible) miss to the catch below.
          await decryptSeedAsync(existingSeeds[0]?.encryptedSeed ?? '', userPin);
        } catch (err) {
          const message =
            err instanceof CryptoOperationError && err.code === CryptoErrorCode.OUTDATED_FORMAT
              ? "This wallet was saved in an older format and must be re-imported."
              : "Incorrect PIN. Please try again.";
          setError("pin", { message });
          setIsStoringPin(false);
          return;
        }
      }

      // Encrypt the seed with the PIN using Web Worker
      // This runs PBKDF2 (600k iterations) off the main thread
      const encryptedSeed = await encryptSeedAsync(mnemonic, hexSeed, userPin);

      // Store the encrypted seed in localStorage
      await StorageUtil.storeEncryptedSeed(
        blockchain,
        accountAddress,
        encryptedSeed
      );

      // If running in native app, notify it to backup the encrypted seed
      // Native app will store in AsyncStorage and prompt for biometric setup
      if (isInNativeApp()) {
        notifySeedStored({
          address: accountAddress,
          encryptedSeed,
          blockchain,
        });
      }

      setIsStoringPin(false);
      onPinSetupComplete();
    } catch (error) {
      setIsStoringPin(false);
      setError("pin", {
        message: `${error} There was an error while setting up the PIN`,
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
        <Card className="border-l-4 border-l-orange-500">
          <CardHeader className="bg-gradient-to-r from-orange-500/5 to-transparent">
            <CardTitle className="text-2xl font-bold">
              {hasExistingSeeds ? "Enter Your Wallet PIN" : "Set Transaction PIN"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                {hasExistingSeeds
                  ? "Enter your existing PIN to add this wallet. All wallets use the same PIN for security."
                  : "Set a PIN to use for transactions instead of entering your seed phrase each time. Your seed phrase will be encrypted with this PIN and stored securely."}
              </p>
              <div className="space-y-4">
                <FormField
                  control={control}
                  name="pin"
                  render={({ field }) => (
                    <PinInput
                      length={6}
                      placeholder={hasExistingSeeds ? "Enter your existing PIN" : "Enter PIN (4-6 digits)"}
                      value={field.value}
                      onChange={field.onChange}
                      disabled={isSubmitting || isStoringPin}
                      description={hasExistingSeeds ? "Your existing wallet PIN" : "Enter a 4-6 digit PIN"}
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
                        disabled={isSubmitting || isStoringPin}
                        description="Re-enter your PIN"
                        error={form.formState.errors.reEnteredPin?.message}
                      />
                    )}
                  />
                )}
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <ShinyButton
              disabled={isSubmitting || !isValid}
              processing={isStoringPin}
              className="w-full"
              type="submit"
            >
              {isStoringPin
                ? "Encrypting..."
                : hasExistingSeeds
                  ? "Import Wallet"
                  : "Set PIN"}
            </ShinyButton>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
};

export default PinSetup;
