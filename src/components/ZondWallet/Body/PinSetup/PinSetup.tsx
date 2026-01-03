import { useState } from "react";
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
import { WalletEncryptionUtil } from "../../../../utilities/walletEncryptionUtil";
import StorageUtil from "../../../../utilities/storageUtil";
import { useStore } from "../../../../stores/store";

const FormSchema = z
  .object({
    pin: z.string().min(4, "PIN must be at least 4 digits").max(6, "PIN must be at most 6 digits"),
    reEnteredPin: z.string().min(4, "PIN must be at least 4 digits").max(6, "PIN must be at most 6 digits"),
  })
  .refine((fields) => fields.pin === fields.reEnteredPin, {
    message: "PINs don't match",
    path: ["reEnteredPin"],
  });

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

  const form = useForm({
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
    formState: { isSubmitting, isValid },
  } = form;

  async function onSubmit(formData: z.output<typeof FormSchema>) {
    try {
      setIsStoringPin(true);
      const userPin = formData.pin;
      
      // Validate PIN format
      if (!WalletEncryptionUtil.validatePin(userPin)) {
        control.setError("pin", {
          message: "PIN must be 4-6 digits",
        });
        setIsStoringPin(false);
        return;
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

      setIsStoringPin(false);
      onPinSetupComplete();
    } catch (error) {
      setIsStoringPin(false);
      control.setError("reEnteredPin", {
        message: `${error} There was an error while setting up the PIN`,
      });
    }
  }

  return (
    <Form {...form}>
      <form className="w-full" onSubmit={handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle>Set Transaction PIN</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                Set a PIN to use for transactions instead of entering your seed phrase each time.
                Your seed phrase will be encrypted with this PIN and stored securely.
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
                      disabled={isSubmitting || isStoringPin}
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
                      disabled={isSubmitting || isStoringPin}
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
              disabled={isSubmitting || isStoringPin || !isValid}
              className="w-full"
              type="submit"
            >
              {isSubmitting || isStoringPin ? (
                <Loader className="mr-2 h-4 w-4 animate-spin" />
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
