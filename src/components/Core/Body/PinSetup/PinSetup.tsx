import { onboardingError, onboardingMessage } from "@/i18n/onboardingMessage";
import { useTranslation } from "react-i18next";
import type { EncryptedSeedData } from "@/utils/storage/storage";
import {
  PinVerificationError,
  verifyPinWithLimit,
} from "@/utils/crypto/verifyPinWithLimit";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardFooter } from "../../../UI/Card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "../../../UI/Form";
import { Input } from "../../../UI/Input";
import { PinInput, type PinInputHandle } from "../../../UI/PinInput/PinInput";
import { ShinyButton } from "../../../UI/ShinyButton";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { minUtf16Length } from "@/utils/zodLength";
import {
  encryptSeedAsync,
  decryptStoredSeedAsync,
  CryptoOperationError,
  CryptoErrorCode,
} from "@/utils/crypto";
import { StorageUtil } from "@/utils/storage";
import { useStore } from "../../../../stores/store";
import { isInNativeApp, notifySeedStored } from "@/utils/nativeApp";
import { isDesktop, desktopSigner } from "@/desktop/bridge";
import { walletMutations } from "@/utils/nativeWalletMutation";
import { DeviceCredentialRecovery } from "./DeviceCredentialRecovery";
import { logger } from "@/utils/log";

// Password must match the signer's policy; same regex the create form uses.
const passwordValidation = z
  .string()
  .superRefine(minUtf16Length(8, "onboarding:passwordMin"))
  .regex(/[A-Z]/, "onboarding:passwordUpper")
  .regex(/[a-z]/, "onboarding:passwordLower")
  .regex(/\d/, "onboarding:passwordNumber")
  .regex(/[!@#$%^&*(),.?":{}|<>]/, "onboarding:passwordSpecial");

// Base PIN validation
const pinValidation = z
  .string()
  .min(4, "onboarding:pinMin")
  .max(6, "onboarding:pinMax")
  .regex(/^\d+$/, "onboarding:pinDigits");

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
      message: "onboarding:pinMismatch",
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
  onPinSetupComplete: (provisionedAddress?: string) => void | Promise<void>;
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
        hexSeed={hexSeed}
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

const DesktopPasswordSchema = z
  .object({
    password: passwordValidation,
    reEnteredPassword: z.string().min(1, "onboarding:passwordRepeatRequired"),
  })
  .refine((data) => data.password === data.reEnteredPassword, {
    message: "onboarding:passwordMismatch",
    path: ["reEnteredPassword"],
  });

const DesktopPasswordSetup = ({
  mnemonic,
  hexSeed,
  onPinSetupComplete,
}: {
  mnemonic: string;
  hexSeed?: string;
  onPinSetupComplete: (provisionedAddress?: string) => void | Promise<void>;
}) => {
  const { t } = useTranslation(["onboarding", "common", "settings"]);
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
      // Mnemonic and hex seed are two encodings of the same bytes; the signer
      // accepts either. Prefer the mnemonic when the form produced one, else
      // fall back to the hex seed (e.g. a wallet file missing its mnemonic).
      const source = mnemonic ? { mnemonic } : { hexSeed };
      const status = await desktopSigner.importWallet(source, data.password);
      setIsProvisioning(false);
      await onPinSetupComplete(status.address);
    } catch (error) {
      setIsProvisioning(false);
      setError("password", {
        message: onboardingError({
          key: "onboarding:importFailed",
          reason: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  }

  return (
    <PageShell
      title={t("onboarding:setPassword")}
      subtitle={t("onboarding:setPasswordHelp")}
      seoTitle={t("onboarding:importTitle")}
    >
      <Form {...form}>
        <form
          className="w-full"
          onSubmit={(event) => {
            void handleSubmit(onSubmit)(event).catch((error: unknown) => {
              logger.error("Failed to submit wallet password:", error);
            });
          }}
        >
          <Card>
            <CardContent className="space-y-6 pt-6">
              <FormField
                control={control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        {...field}
                        disabled={isSubmitting || isProvisioning}
                        placeholder={t("onboarding:password")}
                        type="password"
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
                        disabled={isSubmitting || isProvisioning}
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
            </CardContent>
            <CardFooter>
              <ShinyButton
                disabled={isSubmitting || !isValid || isProvisioning}
                processing={isProvisioning}
                className="w-full"
                type="submit"
              >
                {isProvisioning
                  ? t("onboarding:importing")
                  : t("onboarding:importWallet")}
              </ShinyButton>
            </CardFooter>
          </Card>
        </form>
      </Form>
    </PageShell>
  );
};

const WebPinSetup = ({
  accountAddress,
  mnemonic,
  hexSeed,
  onPinSetupComplete,
}: PinSetupProps) => {
  const { t } = useTranslation(["onboarding", "common", "settings"]);
  const { qrlStore } = useStore();
  const { qrlConnection } = qrlStore;
  const { blockchain } = qrlConnection;
  const [isStoringPin, setIsStoringPin] = useState(false);
  const [needsDeviceRecovery, setNeedsDeviceRecovery] = useState(false);
  const reEnterPinRef = useRef<PinInputHandle>(null);
  const [hasExistingSeeds, setHasExistingSeeds] = useState<boolean | null>(
    null,
  );
  const [existingSeeds, setExistingSeeds] = useState<EncryptedSeedData[]>([]);

  // Check for existing encrypted seeds on mount
  useEffect(() => {
    const checkExistingSeeds = async () => {
      const seeds = await StorageUtil.getAllEncryptedSeeds(blockchain);
      setHasExistingSeeds(seeds.length > 0);
      setExistingSeeds(seeds);
    };
    void checkExistingSeeds().catch((error: unknown) => {
      logger.error("Failed to load encrypted seeds:", error);
    });
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
      setNeedsDeviceRecovery(false);
      const userPin = formData.pin;
      const walletGeneration = walletMutations.captureGeneration();

      // PIN format and matching validation is handled by zod schema

      // If existing seeds exist, verify PIN by attempting to decrypt one
      // Uses Web Worker to avoid blocking UI during PBKDF2
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
          setIsStoringPin(false);
          return;
        }
      }

      // Encrypt the seed with the PIN using Web Worker
      // This runs PBKDF2 (600k iterations) off the main thread
      const encryptedSeed = await encryptSeedAsync(mnemonic, hexSeed, userPin);

      await walletMutations.enqueueWalletMutation(
        async (isCurrent) => {
          if (!isCurrent())
            throw new Error("Wallet was cleared during account import");
          const storedSeed = await StorageUtil.storeEncryptedSeed(
            blockchain,
            accountAddress,
            encryptedSeed,
            isCurrent.epoch,
          );

          if (isInNativeApp()) {
            await notifySeedStored({
              address: accountAddress,
              encryptedSeed,
              blockchain,
              revision: storedSeed.revision ?? 1,
            });
          }
          if (!isCurrent())
            throw new Error("Wallet was cleared during account import");
          await onPinSetupComplete();
        },
        () => {
          throw new Error("Wallet clear is in progress");
        },
        walletGeneration,
      );

      setIsStoringPin(false);
    } catch (error) {
      setIsStoringPin(false);
      setError("pin", {
        message: onboardingError({
          key: "onboarding:setupFailed",
          reason: String(error),
        }),
      });
    }
  }

  // Show loading state while checking for existing seeds
  if (hasExistingSeeds === null) {
    return (
      <PageShell
        title={t("onboarding:secureWallet")}
        seoTitle={t("onboarding:importTitle")}
      >
        <Card>
          <CardContent className="flex items-center justify-center p-6">
            <Loader className="h-6 w-6 animate-spin" />
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={
        hasExistingSeeds
          ? t("onboarding:enterWalletPin")
          : t("onboarding:setTransactionPin")
      }
      seoTitle={t("onboarding:importTitle")}
    >
      <Form {...form}>
        <form
          className="w-full"
          onSubmit={(event) => {
            void handleSubmit(onSubmit)(event).catch((error: unknown) => {
              logger.error("Failed to submit wallet PIN:", error);
            });
          }}
        >
          <Card>
            <CardContent className="space-y-8 pt-6">
              <div>
                <p className="text-sm text-muted-foreground mb-4">
                  {hasExistingSeeds
                    ? t("onboarding:existingPinHelp")
                    : t("onboarding:setPinHelp")}
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
                            ? t("onboarding:enterExistingPin")
                            : t("onboarding:enterPin")
                        }
                        value={field.value}
                        onChange={field.onChange}
                        disabled={isSubmitting || isStoringPin}
                        description={
                          hasExistingSeeds
                            ? t("onboarding:existingWalletPin")
                            : t("onboarding:pinLengthHelp")
                        }
                        error={onboardingMessage(
                          form.formState.errors.pin?.message,
                          t,
                        )}
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
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          disabled={isSubmitting || isStoringPin}
                          description={t("onboarding:repeatPinHelp")}
                          error={onboardingMessage(
                            form.formState.errors.reEnteredPin?.message,
                            t,
                          )}
                        />
                      )}
                    />
                  )}
                </div>
              </div>
            </CardContent>
            {needsDeviceRecovery && (
              <div className="px-6 pb-6">
                <DeviceCredentialRecovery />
              </div>
            )}
            <CardFooter>
              <ShinyButton
                disabled={isSubmitting || !isValid}
                processing={isStoringPin}
                className="w-full"
                type="submit"
              >
                {isStoringPin
                  ? t("onboarding:encrypting")
                  : hasExistingSeeds
                    ? t("onboarding:importWallet")
                    : t("onboarding:setPin")}
              </ShinyButton>
            </CardFooter>
          </Card>
        </form>
      </Form>
    </PageShell>
  );
};

export default PinSetup;
