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

// Unified form schema - reEnteredPin is optional and only validated when needed
const FormSchema = z.object({
  pin: z.string().min(4, "PIN must be at least 4 digits").max(6, "PIN must be at most 6 digits"),
  reEnteredPin: z.string().optional(),
});

type FormValues = z.infer<typeof FormSchema>;

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
      const hasSeeds = await StorageUtil.hasEncryptedSeeds(blockchain);
      setHasExistingSeeds(hasSeeds);
      if (hasSeeds) {
        const seeds = await StorageUtil.getAllEncryptedSeeds(blockchain);
        setExistingSeeds(seeds);
      }
    };
    checkExistingSeeds();
  }, [blockchain]);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    mode: "onChange",
    reValidateMode: "onSubmit",
    defaultValues: {
      pin: "",
      reEnteredPin: "",
    },
  });

  const {
    handleSubmit,
    control,
    formState: { isSubmitting },
    setError,
    watch,
  } = form;

  // eslint-disable-next-line react-hooks/incompatible-library -- React Hook Form watch() is intentionally used for real-time validation
  const pin = watch("pin");
  const reEnteredPin = watch("reEnteredPin");

  // For new PIN setup, check if PINs match and are valid length
  const isFormValid = hasExistingSeeds
    ? pin.length >= 4 && pin.length <= 6
    : pin.length >= 4 && pin.length <= 6 && pin === reEnteredPin;

  async function onSubmit(formData: FormValues) {
    try {
      setIsStoringPin(true);
      const userPin = formData.pin;

      // Validate PIN format
      if (!WalletEncryptionUtil.validatePin(userPin)) {
        setError("pin", {
          message: "PIN must be 4-6 digits",
        });
        setIsStoringPin(false);
        return;
      }

      // For new PIN setup, validate PINs match
      if (!hasExistingSeeds) {
        if (formData.pin !== formData.reEnteredPin) {
          setError("reEnteredPin", {
            message: "PINs don't match",
          });
          setIsStoringPin(false);
          return;
        }
      }

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
              disabled={isSubmitting || isStoringPin || !isFormValid}
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
