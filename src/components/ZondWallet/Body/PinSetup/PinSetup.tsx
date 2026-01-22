import { useState, useEffect } from "react";
import { Button } from "../../../UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../UI/Card";
import {
  Form,
  FormField,
} from "../../../UI/Form";
import { PinInput } from "../../../UI/PinInput/PinInput";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { WalletEncryptionUtil } from "@/utils/crypto";
import { StorageUtil } from "@/utils/storage";
import { useStore } from "../../../../stores/store";
import { isInNativeApp, notifySeedStored } from "@/utils/nativeApp";

// Base PIN validation
const pinValidation = z.string()
  .min(4, "PIN must be at least 4 digits")
  .max(6, "PIN must be at most 6 digits")
  .regex(/^\d+$/, "PIN must contain only digits");

// Schema for existing users - just need to enter their PIN
const ExistingPinSchema = z.object({
  pin: pinValidation,
  reEnteredPin: z.string().optional(),
});

// Schema for new users - must confirm their PIN
const NewPinSchema = z.object({
  pin: pinValidation,
  reEnteredPin: pinValidation,
}).refine((data) => data.pin === data.reEnteredPin, {
  message: "PINs don't match",
  path: ["reEnteredPin"],
});

type FormValues = z.infer<typeof NewPinSchema>;

type PinSetupProps = {
  accountAddress: string;
  mnemonic: string;
  hexSeed: string;
  onPinSetupComplete: () => void;
};

export const PinSetup = ({
  accountAddress,
  mnemonic,
  hexSeed,
  onPinSetupComplete,
}: PinSetupProps) => {
  const { zondStore } = useStore();
  const { zondConnection } = zondStore;
  const { blockchain } = zondConnection;
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

  // Use dynamic schema based on whether user has existing seeds
  const form = useForm<FormValues>({
    resolver: zodResolver(hasExistingSeeds ? ExistingPinSchema : NewPinSchema),
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
      if (hasExistingSeeds && existingSeeds.length > 0) {
        try {
          WalletEncryptionUtil.decryptSeedWithPin(existingSeeds[0].encryptedSeed, userPin);
        } catch {
          setError("pin", {
            message: "Incorrect PIN. Please try again.",
          });
          setIsStoringPin(false);
          return;
        }
      }

      // Encrypt the seed with the PIN
      const encryptedSeed = WalletEncryptionUtil.encryptSeedWithPin(
        mnemonic,
        hexSeed,
        userPin
      );

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
        <Card>
          <CardHeader>
            <CardTitle>
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
            <Button
              disabled={isSubmitting || isStoringPin || !isValid}
              className="w-full"
              type="submit"
            >
              {isSubmitting || isStoringPin ? (
                <Loader className="mr-2 h-4 w-4 animate-spin" />
              ) : hasExistingSeeds ? (
                "Import Wallet"
              ) : (
                "Set PIN"
              )}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
};

export default PinSetup;
