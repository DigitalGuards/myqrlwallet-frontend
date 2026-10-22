import type { SettingsError } from "@/i18n/pinErrorMessage";
import {
  pinErrorMessage,
  settingsValidationMessage,
} from "@/i18n/pinErrorMessage";
import { LanguageSettings } from "./LanguageSettings";
import { useTranslation } from "react-i18next";
import { toNumber } from "@/utils/guards";
import { PinVerificationError } from "@/utils/crypto/verifyPinWithLimit";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { Button } from "../../../UI/Button";
import { Card } from "../../../UI/Card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../../UI/Form";
import { Input } from "../../../UI/Input";
import { Switch } from "@/components/UI/switch";
import { observer } from "mobx-react-lite";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useState, useEffect, useRef, useCallback, lazy } from "react";
import { NetworkSettings } from "./NetworkSettings/NetworkSettings";
import { StorageUtil } from "@/utils/storage";
import {
  BookUser,
  Check,
  ChevronDown,
  ChevronRight,
  Coins,
  Images,
  Shield,
  TimerReset,
} from "lucide-react";
import { useNavigate } from "react-router";
import { ROUTES } from "@/router/router";
import {
  PinInput,
  type PinInputHandle,
} from "@/components/UI/PinInput/PinInput";
import { CryptoErrorCode, CryptoOperationError } from "@/utils/crypto";
import { rotateStoredSeedPin } from "@/utils/crypto/pinRotation";
import { isInNativeApp } from "@/utils/nativeApp";
import { QRL_PROVIDER } from "@/config";
import { isDesktop } from "@/desktop/bridge";
import { withSuspense } from "@/utils/react";
import { cn } from "@/utils/cn";
import { logger } from "@/utils/log";
import { SettingsIconTile, SettingsRow, SettingsSection } from "./SettingsList";
import { ExportWalletFile } from "./ExportWalletFile";
import {
  checkLockout,
  getRemainingAttempts,
  hasFailedAttempts,
} from "@/utils/crypto/pinAttemptTracker";

// Lazy: pulls the dApp-connect service; only worth loading once the settings
// page itself renders (mirrors the router's lazy mount of the same list).
const DAppSessionsList = withSuspense(
  lazy(() => import("../DAppConnect/DAppSessionsList")),
);

type SettingsFormValues = {
  autoLockTimeout: number;
  showTokensCard: unknown;
  showNftsCard: unknown;
};

const SettingsFormSchema: z.ZodType<SettingsFormValues, SettingsFormValues> =
  z.object({
    autoLockTimeout: z.number().min(1).max(60),
    showTokensCard: z.boolean(),
    showNftsCard: z.boolean(),
  });

// Async form defaults leave switch values unset until storage resolves.
const preferenceChecked = (value: unknown) => Boolean(value ?? true);

// Separate schema for Change PIN form
const ChangePinSchema = z
  .object({
    currentPin: z.string().regex(/^\d{4,6}$/, "settings:pinFormat"),
    newPin: z.string().regex(/^\d{4,6}$/, "settings:pinFormat"),
    confirmNewPin: z.string().regex(/^\d{4,6}$/, "settings:pinFormat"),
  })
  .refine((data) => data.newPin === data.confirmNewPin, {
    message: "settings:pinMatch",
    path: ["confirmNewPin"],
  })
  .refine((data) => data.newPin !== data.currentPin, {
    message: "settings:pinDifferent",
    path: ["newPin"],
  });

type ChangePinFormValues = z.infer<typeof ChangePinSchema>;

import { IS_V3_PROFILE } from "@/config/runtimeProfile";
const configuredNetworks = () =>
  IS_V3_PROFILE
    ? ["TEST_NET_V3"]
    : Object.keys(QRL_PROVIDER).filter((id) => id !== "TEST_NET_V3");

const Settings = observer(() => {
  const { t } = useTranslation(["settings", "common"]);
  const navigate = useNavigate();
  const [hasEncryptedSeeds, setHasEncryptedSeeds] = useState(false);
  const [showPinForm, setShowPinForm] = useState(false);
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [changePinError, setChangePinError] = useState<SettingsError | null>(
    null,
  );
  const [changePinSuccess, setChangePinSuccess] = useState(false);
  const [pinLockout, setPinLockout] = useState<{
    isLocked: boolean;
    remainingMs: number;
  }>({ isLocked: false, remainingMs: 0 });
  const [attemptsLeft, setAttemptsLeft] = useState(5);
  const [settingsSaveSuccess, setSettingsSaveSuccess] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState<
    "settings:saveError" | null
  >(null);
  const newPinRef = useRef<PinInputHandle>(null);
  const confirmPinRef = useRef<PinInputHandle>(null);

  // Check for existing encrypted seeds on mount
  useEffect(() => {
    const checkSeeds = async () => {
      const hasSeeds = (
        await Promise.all(
          configuredNetworks().map((blockchain) =>
            StorageUtil.hasEncryptedSeeds(blockchain),
          ),
        )
      ).some(Boolean);
      setHasEncryptedSeeds(hasSeeds);
    };
    void checkSeeds().catch((error: unknown) => {
      logger.error("Failed to check encrypted seeds:", error);
    });
  }, []);

  // Check and update lockout status
  useEffect(() => {
    const updateLockoutStatus = () => {
      const lockoutStatus = checkLockout();
      setPinLockout(lockoutStatus);
      setAttemptsLeft(getRemainingAttempts());
    };

    updateLockoutStatus();

    // Update every second if locked out (to show countdown)
    const interval = setInterval(() => {
      const lockoutStatus = checkLockout();
      setPinLockout(lockoutStatus);
      if (!lockoutStatus.isLocked) {
        setAttemptsLeft(getRemainingAttempts());
      }
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  // Last persisted auto-lock value: the fallback when a save must proceed
  // while the timer field holds an invalid/in-progress edit.
  const lastSavedTimerRef = useRef(15);

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(SettingsFormSchema),
    // Never yank focus into the timer input from a background save.
    shouldFocusError: false,
    defaultValues: async () => {
      const settings = await StorageUtil.getWalletSettings();
      const minutes = settings.autoLockTimeout
        ? Math.floor(toNumber(settings.autoLockTimeout) / (60 * 1000))
        : 15;
      lastSavedTimerRef.current = minutes;
      return {
        autoLockTimeout: minutes,
        showTokensCard: settings.showTokensCard,
        showNftsCard: settings.showNftsCard,
      };
    },
  });

  const onSubmit = useCallback(async (data: SettingsFormValues) => {
    setSettingsSaveSuccess(false);
    setSettingsSaveError(null);
    try {
      // Convert minutes to milliseconds for storage
      const settingsToSave = {
        ...data,
        autoLockTimeout: data.autoLockTimeout * 60 * 1000,
      };
      await StorageUtil.setWalletSettings(settingsToSave);
      lastSavedTimerRef.current = data.autoLockTimeout;
      setSettingsSaveSuccess(true);
    } catch (_error) {
      setSettingsSaveError("settings:saveError");
    }
  }, []);

  // Preferences auto-save on change (debounced so rapid toggles and
  // keystrokes in the timer input collapse into one write).
  const saveTimer = useRef<number | null>(null);

  // sanitizeTimer: a save triggered by something other than the timer field
  // itself (switch toggle, blur, unmount) must not be blocked by a
  // half-typed timer value; substitute the last persisted one instead.
  // Timer-keystroke saves pass false so we never rewrite the field while
  // the user is still typing; the invalid value just surfaces its message
  // and no write happens until it is fixed or blurred.
  const flushSave = useCallback(
    (sanitizeTimer: boolean) => {
      const timer = form.getValues("autoLockTimeout");
      const invalid = !Number.isFinite(timer) || timer < 1 || timer > 60;
      if (invalid && !sanitizeTimer) {
        void form.trigger("autoLockTimeout").catch((error: unknown) => {
          logger.error("Failed to validate wallet settings:", error);
          setSettingsSaveError("settings:saveError");
        });
        return;
      }
      if (invalid) {
        form.setValue("autoLockTimeout", lastSavedTimerRef.current, {
          shouldValidate: true,
        });
      }
      void form
        .handleSubmit(onSubmit)()
        .catch((error: unknown) => {
          logger.error("Failed to submit wallet settings:", error);
          setSettingsSaveError("settings:saveError");
        });
    },
    [form, onSubmit],
  );

  const queueSave = (delayMs: number, sanitizeTimer = false) => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      flushSave(sanitizeTimer);
    }, delayMs);
  };

  // Flush a pending save on unmount or when the page is hidden.
  useEffect(() => {
    const flushPendingSave = () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        flushSave(true);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingSave();
      }
    };

    window.addEventListener("pagehide", flushPendingSave);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushPendingSave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushPendingSave();
    };
  }, [flushSave]);

  // Transient "Saved" chip in the Preferences section header
  useEffect(() => {
    if (!settingsSaveSuccess) return;
    const timeout = setTimeout(() => {
      setSettingsSaveSuccess(false);
    }, 2500);
    return () => {
      clearTimeout(timeout);
    };
  }, [settingsSaveSuccess]);

  // Change PIN form
  const changePinForm = useForm<ChangePinFormValues>({
    resolver: zodResolver(ChangePinSchema),
    defaultValues: {
      currentPin: "",
      newPin: "",
      confirmNewPin: "",
    },
  });

  async function onChangePinSubmit(data: ChangePinFormValues) {
    setIsChangingPin(true);
    setChangePinError(null);
    setChangePinSuccess(false);

    try {
      await rotateStoredSeedPin({
        blockchains: configuredNetworks(),
        oldPin: data.currentPin,
        newPin: data.newPin,
      });

      setAttemptsLeft(5);

      // Show success in card
      setChangePinSuccess(true);

      // Reset form
      changePinForm.reset();
    } catch (error) {
      logger.error("Error changing PIN:", error);
      if (
        error instanceof CryptoOperationError &&
        error.code === CryptoErrorCode.DEVICE_CREDENTIAL_UNAVAILABLE
      ) {
        setChangePinError({ key: "settings:credentialPin" });
      } else if (error instanceof PinVerificationError) {
        setPinLockout(error);
        setAttemptsLeft(error.attemptsLeft);
        setChangePinError(pinErrorMessage(error));
      } else if (
        error instanceof Error &&
        error.message === "No encrypted seeds found"
      ) {
        setChangePinError({ key: "settings:noSeeds" });
      } else {
        setChangePinError(
          error instanceof Error &&
            error.message.includes("old PIN remains active")
            ? {
                key: "settings:pinBackupFailed",
                message:
                  error.message ===
                  "Native seed backup failed; the old PIN remains active."
                    ? undefined
                    : error.message,
              }
            : { key: "settings:pinError" },
        );
      }
    } finally {
      setIsChangingPin(false);
    }
  }

  return (
    <>
      <PageShell title={t("common:settings")} seoTitle={t("common:settings")}>
        <div className="space-y-5 md:space-y-6">
          {/* Security is browser-only here. Native routes Settings
                            to its request-bound PIN flow, and desktop uses a
                            password / Argon2id rather than this PIN. */}
          {hasEncryptedSeeds && !isDesktop && !isInNativeApp() && (
            <SettingsSection title={t("settings:security")}>
              <SettingsRow
                icon={Shield}
                tint="bg-primary/15 text-primary"
                title={t("settings:changePin")}
                subtitle={t("settings:changePinHint")}
                right={
                  <>
                    {/* Lockout state must be visible without expanding
                                                the panel. */}
                    {pinLockout.isLocked ? (
                      <span className="text-xs font-medium text-destructive">
                        {t("settings:locked")}
                      </span>
                    ) : hasFailedAttempts() && attemptsLeft < 5 ? (
                      <span className="text-xs text-yellow-400">
                        {t("settings:attemptsLeft", { count: attemptsLeft })}
                      </span>
                    ) : null}
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                        showPinForm && "rotate-180",
                      )}
                    />
                  </>
                }
                onClick={() => {
                  setShowPinForm((open) => !open);
                }}
                // Collapsing mid-change would hide the outcome banner.
                disabled={isChangingPin}
                ariaExpanded={showPinForm}
                ariaControls="change-pin-panel"
              />
              {showPinForm && (
                <div id="change-pin-panel" className="px-4 pb-4 pt-3">
                  <Form {...changePinForm}>
                    <form
                      onSubmit={(event) => {
                        void changePinForm
                          .handleSubmit(onChangePinSubmit)(event)
                          .catch((error: unknown) => {
                            logger.error("Error changing PIN:", error);
                            setChangePinError({ key: "settings:pinError" });
                          });
                      }}
                      className="space-y-4"
                    >
                      {pinLockout.isLocked && (
                        <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                          {t("settings:lockout", {
                            count: Math.ceil(pinLockout.remainingMs / 60000),
                          })}
                        </div>
                      )}
                      {!pinLockout.isLocked &&
                        hasFailedAttempts() &&
                        attemptsLeft > 0 && (
                          <div className="rounded-md bg-yellow-500/15 p-3 text-sm text-yellow-400">
                            {t("settings:beforeLockout", {
                              count: attemptsLeft,
                            })}
                          </div>
                        )}
                      {changePinError && !pinLockout.isLocked && (
                        <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                          {changePinError.message ??
                            t(changePinError.key, {
                              count: changePinError.count,
                            })}
                        </div>
                      )}
                      {changePinSuccess && (
                        <div className="rounded-md bg-success/15 p-3 text-sm text-success">
                          {t("settings:pinSuccess")}
                        </div>
                      )}

                      <FormField
                        control={changePinForm.control}
                        name="currentPin"
                        render={({ field, fieldState }) => (
                          <FormItem>
                            <FormLabel>{t("settings:currentPin")}</FormLabel>
                            <FormControl>
                              <PinInput
                                value={field.value}
                                onChange={field.onChange}
                                placeholder={t("settings:enterCurrentPin")}
                                error={settingsValidationMessage(
                                  fieldState.error?.message,
                                  t,
                                )}
                                disabled={isChangingPin || pinLockout.isLocked}
                                onComplete={() => newPinRef.current?.focus()}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={changePinForm.control}
                        name="newPin"
                        render={({ field, fieldState }) => (
                          <FormItem>
                            <FormLabel>{t("settings:newPin")}</FormLabel>
                            <FormControl>
                              <PinInput
                                ref={newPinRef}
                                value={field.value}
                                onChange={field.onChange}
                                placeholder={t("settings:enterNewPin")}
                                error={settingsValidationMessage(
                                  fieldState.error?.message,
                                  t,
                                )}
                                disabled={isChangingPin || pinLockout.isLocked}
                                onComplete={() =>
                                  confirmPinRef.current?.focus()
                                }
                              />
                            </FormControl>
                            <FormDescription>
                              {t("settings:pinFormat")}
                            </FormDescription>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={changePinForm.control}
                        name="confirmNewPin"
                        render={({ field, fieldState }) => (
                          <FormItem>
                            <FormLabel>{t("settings:confirmPin")}</FormLabel>
                            <FormControl>
                              <PinInput
                                ref={confirmPinRef}
                                value={field.value}
                                onChange={field.onChange}
                                placeholder={t("settings:enterConfirmPin")}
                                error={settingsValidationMessage(
                                  fieldState.error?.message,
                                  t,
                                )}
                                disabled={isChangingPin || pinLockout.isLocked}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <Button
                        type="submit"
                        className="w-full"
                        disabled={isChangingPin || pinLockout.isLocked}
                      >
                        <Shield className="mr-2 h-4 w-4" />
                        {isChangingPin
                          ? t("settings:changingPin")
                          : t("settings:changePin")}
                      </Button>
                    </form>
                  </Form>
                </div>
              )}
              <ExportWalletFile />
            </SettingsSection>
          )}

          <NetworkSettings />

          <Form {...form}>
            <SettingsSection
              title={t("settings:preferences")}
              action={
                settingsSaveSuccess ? (
                  <span
                    role="status"
                    className="flex items-center gap-1 text-xs text-success"
                  >
                    <Check className="h-3 w-3" />
                    {t("settings:saved")}
                  </span>
                ) : undefined
              }
            >
              <LanguageSettings />
              {settingsSaveError && (
                <div
                  role="alert"
                  className="bg-destructive/10 px-4 py-2 text-xs text-destructive"
                >
                  {t(settingsSaveError)}
                </div>
              )}

              <FormField
                control={form.control}
                name="autoLockTimeout"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <SettingsIconTile
                        icon={TimerReset}
                        tint="bg-violet-500/15 text-violet-400"
                      />
                      <div className="min-w-0 flex-1">
                        <FormLabel className="text-sm font-medium">
                          {t("settings:autoLock")}
                        </FormLabel>
                        <FormDescription className="mt-0.5 text-xs">
                          {t("settings:autoLockHint")}
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={60}
                          className="h-9 w-20 shrink-0 text-center"
                          {...field}
                          value={
                            Number.isFinite(field.value) ? field.value : ""
                          }
                          onChange={(e) => {
                            // Empty stays empty while typing (NaN fails
                            // validation, so nothing is written).
                            field.onChange(
                              e.target.value === ""
                                ? Number.NaN
                                : Number(e.target.value),
                            );
                            queueSave(800);
                          }}
                          onBlur={() => {
                            field.onBlur();
                            const t = form.getValues("autoLockTimeout");
                            const invalid =
                              !Number.isFinite(t) || t < 1 || t > 60;
                            // Flush a pending save early; leaving the field
                            // invalid reverts it to the last saved value.
                            if (invalid || saveTimer.current !== null) {
                              queueSave(0, true);
                            }
                          }}
                        />
                      </FormControl>
                    </div>
                    <FormMessage className="px-4 pb-3 text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="showTokensCard"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-3 space-y-0 px-4 py-3">
                    <SettingsIconTile
                      icon={Coins}
                      tint="bg-sky-500/15 text-sky-400"
                    />
                    <div className="min-w-0 flex-1">
                      <FormLabel className="text-sm font-medium">
                        {t("settings:showTokens")}
                      </FormLabel>
                      <FormDescription className="mt-0.5 text-xs">
                        {t("settings:showTokensHint")}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={preferenceChecked(field.value)}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          queueSave(200, true);
                        }}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="showNftsCard"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-3 space-y-0 px-4 py-3">
                    <SettingsIconTile
                      icon={Images}
                      tint="bg-fuchsia-500/15 text-fuchsia-400"
                    />
                    <div className="min-w-0 flex-1">
                      <FormLabel className="text-sm font-medium">
                        {t("settings:showNfts")}
                      </FormLabel>
                      <FormDescription className="mt-0.5 text-xs">
                        {t("settings:showNftsHint")}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={preferenceChecked(field.value)}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          queueSave(200, true);
                        }}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </SettingsSection>
          </Form>

          <SettingsSection title={t("settings:connections")}>
            <SettingsRow
              icon={BookUser}
              tint="bg-secondary/15 text-secondary"
              title={t("settings:addressBook")}
              subtitle={t("settings:addressBookHint")}
              right={
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              }
              onClick={() => {
                void Promise.resolve(navigate(ROUTES.ADDRESS_BOOK)).catch(
                  (error: unknown) => {
                    logger.error("Failed to open address book:", error);
                  },
                );
              }}
            />
          </SettingsSection>

          {/* dApp session management lives here (the list keeps
              its own header + actions); the /dapp-sessions route
              mounts the same component for deep links. Desktop
              never reaches this page: its Settings entry opens
              the native settings window (see utils/navigation). */}
          <Card>
            <DAppSessionsList />
          </Card>
        </div>
      </PageShell>
    </>
  );
});

export default Settings;
