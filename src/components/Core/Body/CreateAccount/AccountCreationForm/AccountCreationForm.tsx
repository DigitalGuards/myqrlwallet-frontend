import { onboardingError, onboardingMessage } from "@/i18n/onboardingMessage";
import { useTranslation } from "react-i18next";
import type { BlockchainSelection } from "@/utils/storage/storage";
import type { EncryptedSeedData } from "@/utils/storage/storage";
import { logger } from "@/utils/log";
import {
  PinVerificationError,
  verifyPinWithLimit,
} from "@/utils/crypto/verifyPinWithLimit";
import { useState, useEffect, useRef } from "react";
import { ShinyButton } from "@/components/UI/ShinyButton";
import { Card, CardContent, CardFooter } from "@/components/UI/Card";
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
import type { Web3BaseWalletAccount } from "@theqrl/web3";
import { Loader, Plus } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { minUtf16Length } from "@/utils/zodLength";
import {
  encryptSeedAsync,
  decryptStoredSeedAsync,
  getMnemonicFromHexSeed,
  CryptoOperationError,
  CryptoErrorCode,
} from "@/utils/crypto";
import { StorageUtil } from "@/utils/storage";
import { isInNativeApp, notifySeedStored } from "@/utils/nativeApp";
import {
  PinInput,
  type PinInputHandle,
} from "@/components/UI/PinInput/PinInput";
import { Separator } from "@/components/UI/Separator";
import { isDesktop, desktopSigner } from "@/desktop/bridge";
import { walletMutations } from "@/utils/nativeWalletMutation";
import { DeviceCredentialRecovery } from "../../PinSetup/DeviceCredentialRecovery";

// Password must match WalletEncryptionUtil.validatePassword() requirements
const passwordValidation = z
  .string()
  .superRefine(minUtf16Length(8, "onboarding:passwordMin"))
  .regex(/[A-Z]/, "onboarding:passwordUpper")
  .regex(/[a-z]/, "onboarding:passwordLower")
  .regex(/\d/, "onboarding:passwordNumber")
  .regex(/[!@#$%^&*(),.?":{}|<>]/, "onboarding:passwordSpecial");

const pinValidation = z
  .string()
  .min(4, "onboarding:pinMin")
  .max(6, "onboarding:pinMax")
  .regex(/^\d+$/, "onboarding:pinDigits");

// Base form values type - reEnteredPin is always present but may be empty
type FormValues = {
  password: string;
  reEnteredPassword: string;
  pin: string;
  reEnteredPin: string;
};

// Schema for new users (no existing seeds) - requires PIN confirmation
const NewUserSchema = z
  .object({
    password: passwordValidation,
    reEnteredPassword: z.string().min(1, "onboarding:passwordRepeatRequired"),
    pin: pinValidation,
    reEnteredPin: pinValidation,
  })
  .refine((data) => data.password === data.reEnteredPassword, {
    message: "onboarding:passwordMismatch",
    path: ["reEnteredPassword"],
  })
  .refine((data) => data.pin === data.reEnteredPin, {
    message: "onboarding:pinMismatch",
    path: ["reEnteredPin"],
  });

// Schema for existing users - no PIN confirmation needed
const ExistingUserSchema = z
  .object({
    password: passwordValidation,
    reEnteredPassword: z.string().min(1, "onboarding:passwordRepeatRequired"),
    pin: pinValidation,
    reEnteredPin: z.string(), // Present but not validated
  })
  .refine((data) => data.password === data.reEnteredPassword, {
    message: "onboarding:passwordMismatch",
    path: ["reEnteredPassword"],
  });

// Desktop schema - PIN is not used (the signer does Argon2id over a password);
// only the password and its confirmation are validated. The PIN fields stay
// present in the form values so the shared form typing is unchanged.
const DesktopSchema = z
  .object({
    password: passwordValidation,
    reEnteredPassword: z.string().min(1, "onboarding:passwordRepeatRequired"),
    pin: z.string(),
    reEnteredPin: z.string(),
  })
  .refine((data) => data.password === data.reEnteredPassword, {
    message: "onboarding:passwordMismatch",
    path: ["reEnteredPassword"],
  });

type AccountCreationFormProps = {
  // On desktop, `account` is undefined and the signer-returned mnemonic +
  // address are supplied so the backup screen can render without any seed
  // material in the renderer.
  onAccountCreated: (
    account: Web3BaseWalletAccount | undefined,
    password: string,
    desktopBackup?: { address: string; mnemonic: string },
  ) => void | Promise<void>;
};

type InnerFormProps = {
  onAccountCreated: (
    account: Web3BaseWalletAccount | undefined,
    password: string,
    desktopBackup?: { address: string; mnemonic: string },
  ) => void | Promise<void>;
  hasExistingSeeds: boolean;
  existingSeeds: EncryptedSeedData[];
  blockchain: BlockchainSelection;
};

/**
 * Inner form component - only rendered after we know if user has existing seeds.
 * This ensures the correct schema is used from the start.
 */
const InnerForm = observer(
  ({
    onAccountCreated,
    hasExistingSeeds,
    existingSeeds,
    blockchain,
  }: InnerFormProps) => {
    const { t } = useTranslation(["onboarding", "common", "settings"]);
    const { qrlStore } = useStore();
    const { qrlInstance } = qrlStore;
    const [isEncrypting, setIsEncrypting] = useState(false);
    const [needsDeviceRecovery, setNeedsDeviceRecovery] = useState(false);
    const reEnterPinRef = useRef<PinInputHandle>(null);

    // Select schema based on whether user has existing seeds. On desktop the
    // password is the only secret (no PIN) so a dedicated schema is used.
    const schema = isDesktop
      ? DesktopSchema
      : hasExistingSeeds
        ? ExistingUserSchema
        : NewUserSchema;

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
        setNeedsDeviceRecovery(false);
        const userPassword = formData.password;
        const userPin = formData.pin;

        // Desktop: the signer generates the seed and returns the mnemonic ONCE
        // for backup. No seed material is materialised, encrypted, or stored in
        // the renderer (no accounts.create / getMnemonicFromHexSeed /
        // encryptSeedAsync / storeEncryptedSeed).
        if (isDesktop) {
          setIsEncrypting(true);
          try {
            const { status, mnemonic } =
              await desktopSigner.createWallet(userPassword);
            setIsEncrypting(false);
            await onAccountCreated(undefined, userPassword, {
              address: status.address,
              mnemonic,
            });
          } catch (err) {
            setIsEncrypting(false);
            setError("root", {
              message: onboardingError({
                key: "onboarding:createFailed",
                reason: err instanceof Error ? err.message : String(err),
              }),
            });
          }
          return;
        }

        const walletGeneration = walletMutations.captureGeneration();

        // If existing seeds exist, verify PIN by attempting to decrypt one
        if (hasExistingSeeds && existingSeeds.length > 0) {
          try {
            // length > 0 is checked above; `?? ''` only satisfies the index
            // checker and would route an (impossible) miss to the catch below.
            const existingSeed = existingSeeds[0];
            await verifyPinWithLimit(() =>
              decryptStoredSeedAsync(
                blockchain,
                existingSeed?.address ?? "",
                existingSeed?.encryptedSeed ?? "",
                userPin,
              ),
            );
          } catch (err) {
            const missingDeviceCredential =
              err instanceof CryptoOperationError &&
              err.code === CryptoErrorCode.DEVICE_CREDENTIAL_UNAVAILABLE;
            setNeedsDeviceRecovery(missingDeviceCredential);
            const message =
              err instanceof PinVerificationError
                ? err.message
                : err instanceof CryptoOperationError &&
                    err.code === CryptoErrorCode.OUTDATED_FORMAT
                  ? "onboarding:olderFormat"
                  : missingDeviceCredential
                    ? "onboarding:credentialUnavailable"
                    : "onboarding:unlockFailed";
            setError("pin", { message });
            return;
          }
        }

        // Create the account
        const newAccount = await Promise.resolve(
          qrlInstance?.accounts.create(),
        );
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
        const encryptedSeed = await encryptSeedAsync(
          mnemonic,
          hexSeed,
          userPin,
        );

        await walletMutations.enqueueWalletMutation(
          async (isCurrent) => {
            if (!isCurrent())
              throw new Error("Wallet was cleared during account creation");
            const storedSeed = await StorageUtil.storeEncryptedSeed(
              blockchain,
              newAccount.address,
              encryptedSeed,
              isCurrent.epoch,
            );

            if (isInNativeApp()) {
              await notifySeedStored({
                address: newAccount.address,
                encryptedSeed,
                blockchain,
                revision: storedSeed.revision ?? 1,
              });
            }
            if (!isCurrent())
              throw new Error("Wallet was cleared during account creation");
            await onAccountCreated(newAccount, userPassword);
          },
          () => {
            throw new Error("Wallet clear is in progress");
          },
          walletGeneration,
        );

        setIsEncrypting(false);
      } catch (error) {
        setIsEncrypting(false);
        setError("root", {
          message: onboardingError({
            key: "onboarding:createFailed",
            reason: String(error),
          }),
        });
      }
    }

    const isProcessing = isSubmitting || isEncrypting;
    const buttonText = isEncrypting
      ? t("onboarding:encrypting")
      : isSubmitting
        ? t("onboarding:creating")
        : t("onboarding:create");

    return (
      <Form {...form}>
        <form
          className="w-full"
          onSubmit={(event) => {
            handleSubmit(onSubmit)(event).catch((error: unknown) => {
              setError("root", {
                message: onboardingError({
                  key: "onboarding:createFailed",
                  reason: String(error),
                }),
              });
            });
          }}
        >
          <Card>
            <CardContent className="space-y-8 pt-6">
              <div>
                <h3 className="text-lg font-medium mb-4">
                  {t("onboarding:walletPassword")}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("onboarding:backupPassword")}
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
                            placeholder={t("onboarding:password")}
                            type="password"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t("onboarding:passwordRules")}
                        </FormDescription>
                        <FormMessage
                          translateMessage={(message) =>
                            onboardingMessage(message, t)
                          }
                        />
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
                            placeholder={t("onboarding:passwordRepeat")}
                            type="password"
                          />
                        </FormControl>
                        <FormDescription>
                          {t("onboarding:passwordRepeat")}
                        </FormDescription>
                        <FormMessage
                          translateMessage={(message) =>
                            onboardingMessage(message, t)
                          }
                        />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* PIN section is web/native only. On desktop the signer uses the
                password (Argon2id) and there is no per-transaction PIN. */}
              {!isDesktop && (
                <>
                  <Separator />

                  <div>
                    <h3 className="text-lg font-medium mb-4">
                      {hasExistingSeeds
                        ? t("onboarding:existingPinTitle")
                        : t("onboarding:transactionPin")}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {hasExistingSeeds
                        ? t("onboarding:existingPinHelp")
                        : isInNativeApp()
                          ? t("onboarding:nativePinHelp")
                          : t("onboarding:webPinHelp")}
                    </p>
                    <div className="space-y-4">
                      <FormField
                        control={control}
                        name="pin"
                        render={({ field }) => (
                          <PinInput
                            length={6}
                            placeholder={
                              hasExistingSeeds
                                ? t("onboarding:existingPin")
                                : t("onboarding:enterPin")
                            }
                            value={field.value}
                            onChange={field.onChange}
                            disabled={isSubmitting}
                            description={
                              hasExistingSeeds
                                ? t("onboarding:samePin")
                                : t("onboarding:pinLengthHelp")
                            }
                            error={onboardingMessage(errors.pin?.message, t)}
                            onComplete={() => reEnterPinRef.current?.focus()}
                          />
                        )}
                      />
                      {!hasExistingSeeds && (
                        <FormField
                          control={control}
                          name="reEnteredPin"
                          render={({ field }) => (
                            <PinInput
                              ref={reEnterPinRef}
                              length={6}
                              placeholder={t("onboarding:repeatPin")}
                              value={field.value}
                              onChange={field.onChange}
                              disabled={isSubmitting}
                              description={t("onboarding:repeatPinHelp")}
                              error={onboardingMessage(
                                errors.reEnteredPin?.message,
                                t,
                              )}
                            />
                          )}
                        />
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
            {needsDeviceRecovery && (
              <div className="px-6 pb-6">
                <DeviceCredentialRecovery />
              </div>
            )}
            <CardFooter className="flex-col gap-4">
              {errors.root && (
                <p className="text-sm text-destructive w-full">
                  {onboardingMessage(errors.root.message, t)}
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
  },
);

/**
 * Wrapper component that loads seed data before rendering the form.
 * This ensures the form schema is determined correctly.
 */
export const AccountCreationForm = observer(
  ({ onAccountCreated }: AccountCreationFormProps) => {
    const { t } = useTranslation(["onboarding", "common", "settings"]);
    const { qrlStore } = useStore();
    const { qrlConnection } = qrlStore;
    const { blockchain } = qrlConnection;
    const [hasExistingSeeds, setHasExistingSeeds] = useState<boolean | null>(
      null,
    );
    const [existingSeeds, setExistingSeeds] = useState<EncryptedSeedData[]>([]);

    const [loadError, setLoadError] = useState(false);

    // Check for existing encrypted seeds on mount
    useEffect(() => {
      const checkExistingSeeds = async () => {
        const seeds = await StorageUtil.getAllEncryptedSeeds(blockchain);
        setHasExistingSeeds(seeds.length > 0);
        setExistingSeeds(seeds);
      };
      checkExistingSeeds().catch((error: unknown) => {
        logger.error("Failed to load existing wallets:", error);
        setLoadError(true);
      });
    }, [blockchain]);

    if (loadError) {
      return <p role="alert">{t("onboarding:loadWalletsFailed")}</p>;
    }

    // Show loading state while checking for existing seeds
    if (hasExistingSeeds === null) {
      return (
        <Card>
          <CardContent className="flex items-center justify-center py-8 pt-6">
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
  },
);
