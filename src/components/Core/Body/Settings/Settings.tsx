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
import type { EncryptedSeedData } from "@/utils/storage";
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
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/router/router";
import { SEO } from "@/components/SEO/SEO";
import { PinInput, type PinInputHandle } from "@/components/UI/PinInput/PinInput";
import { decryptSeedAsync, reEncryptSeedAsync } from "@/utils/crypto";
import { isInNativeApp, sendPinChanged } from "@/utils/nativeApp";
import { isDesktop } from "@/desktop/bridge";
import { withSuspense } from "@/utils/react";
import { cn } from "@/utils/cn";
import { SettingsIconTile, SettingsRow, SettingsSection } from "./SettingsList";
import { ExportWalletFile } from "./ExportWalletFile";
import {
    checkLockout,
    recordFailedAttempt,
    recordSuccessfulAttempt,
    formatLockoutTime,
    getRemainingAttempts,
    hasFailedAttempts,
} from "@/utils/crypto/pinAttemptTracker";

// Lazy: pulls the dApp-connect service; only worth loading once the settings
// page itself renders (mirrors the router's lazy mount of the same list).
const DAppSessionsList = withSuspense(
    lazy(() => import("../DAppConnect/DAppSessionsList")),
);

const SettingsFormSchema = z.object({
    autoLockTimeout: z.number().min(1).max(60),
    showTokensCard: z.boolean(),
    showNftsCard: z.boolean(),
});

type SettingsFormValues = z.infer<typeof SettingsFormSchema>;

// Separate schema for Change PIN form
const ChangePinSchema = z.object({
    currentPin: z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits"),
    newPin: z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits"),
    confirmNewPin: z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits"),
}).refine((data) => data.newPin === data.confirmNewPin, {
    message: "New PINs must match",
    path: ["confirmNewPin"],
}).refine((data) => data.newPin !== data.currentPin, {
    message: "New PIN must be different from current PIN",
    path: ["newPin"],
});

type ChangePinFormValues = z.infer<typeof ChangePinSchema>;

const Settings = observer(() => {
    const navigate = useNavigate();
    const [hasEncryptedSeeds, setHasEncryptedSeeds] = useState(false);
    const [showPinForm, setShowPinForm] = useState(false);
    const [isChangingPin, setIsChangingPin] = useState(false);
    const [changePinError, setChangePinError] = useState<string | null>(null);
    const [changePinSuccess, setChangePinSuccess] = useState(false);
    const [pinLockout, setPinLockout] = useState<{ isLocked: boolean; remainingMs: number }>({ isLocked: false, remainingMs: 0 });
    const [attemptsLeft, setAttemptsLeft] = useState(5);
    const [settingsSaveSuccess, setSettingsSaveSuccess] = useState(false);
    const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
    const newPinRef = useRef<PinInputHandle>(null);
    const confirmPinRef = useRef<PinInputHandle>(null);

    // Check for existing encrypted seeds on mount
    useEffect(() => {
        const checkSeeds = async () => {
            const blockchain = await StorageUtil.getBlockChain();
            const hasSeeds = await StorageUtil.hasEncryptedSeeds(blockchain);
            setHasEncryptedSeeds(hasSeeds);
        };
        checkSeeds();
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

        return () => clearInterval(interval);
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
            const minutes = settings.autoLockTimeout ? Math.floor(settings.autoLockTimeout / (60 * 1000)) : 15;
            lastSavedTimerRef.current = minutes;
            return {
                autoLockTimeout: minutes,
                showTokensCard: settings.showTokensCard ?? true,
                showNftsCard: settings.showNftsCard ?? true,
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
                autoLockTimeout: data.autoLockTimeout * 60 * 1000
            };
            await StorageUtil.setWalletSettings(settingsToSave);
            lastSavedTimerRef.current = data.autoLockTimeout;
            setSettingsSaveSuccess(true);
        } catch (_error) {
            setSettingsSaveError("There was an error saving your settings.");
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
    const flushSave = useCallback((sanitizeTimer: boolean) => {
        const timer = form.getValues("autoLockTimeout");
        const invalid = !Number.isFinite(timer) || timer < 1 || timer > 60;
        if (invalid && !sanitizeTimer) {
            void form.trigger("autoLockTimeout");
            return;
        }
        if (invalid) {
            form.setValue("autoLockTimeout", lastSavedTimerRef.current, { shouldValidate: true });
        }
        void form.handleSubmit(onSubmit)();
    }, [form, onSubmit]);

    const queueSave = (delayMs: number, sanitizeTimer = false) => {
        if (saveTimer.current !== null) {
            window.clearTimeout(saveTimer.current);
        }
        saveTimer.current = window.setTimeout(() => {
            saveTimer.current = null;
            flushSave(sanitizeTimer);
        }, delayMs);
    };

    // Flush (not discard) a pending save on unmount, so a toggle followed by
    // an immediate navigation still persists.
    useEffect(() => {
        return () => {
            if (saveTimer.current !== null) {
                window.clearTimeout(saveTimer.current);
                saveTimer.current = null;
                flushSave(true);
            }
        };
    }, [flushSave]);

    // Transient "Saved" chip in the Preferences section header
    useEffect(() => {
        if (!settingsSaveSuccess) return;
        const timeout = setTimeout(() => setSettingsSaveSuccess(false), 2500);
        return () => clearTimeout(timeout);
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
        // Check if locked out
        const lockoutStatus = checkLockout();
        if (lockoutStatus.isLocked) {
            setChangePinError(`Too many failed attempts. Please wait ${formatLockoutTime(lockoutStatus.remainingMs)}.`);
            return;
        }

        setIsChangingPin(true);
        setChangePinError(null);
        setChangePinSuccess(false);

        try {
            const blockchain = await StorageUtil.getBlockChain();
            const allSeeds = await StorageUtil.getAllEncryptedSeeds(blockchain);

            if (allSeeds.length === 0) {
                setChangePinError("No encrypted seeds found.");
                return;
            }

            // Verify current PIN by attempting to decrypt the first seed
            // Uses Web Worker to avoid blocking UI during PBKDF2
            try {
                await decryptSeedAsync(allSeeds[0]?.encryptedSeed ?? '', data.currentPin);
            } catch {
                // Record failed attempt
                const result = recordFailedAttempt();
                setPinLockout({ isLocked: result.isLocked, remainingMs: result.remainingMs });
                setAttemptsLeft(result.attemptsLeft);

                if (result.isLocked) {
                    setChangePinError(`Too many failed attempts. Please wait ${formatLockoutTime(result.remainingMs)}.`);
                } else {
                    setChangePinError(`Incorrect PIN. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} remaining.`);
                }
                return;
            }

            // Re-encrypt all seeds with the new PIN using Web Worker
            // This runs PBKDF2 (600k iterations) off the main thread
            const updatedSeeds: EncryptedSeedData[] = await Promise.all(
                allSeeds.map(async (seed) => ({
                    ...seed,
                    encryptedSeed: await reEncryptSeedAsync(
                        seed.encryptedSeed,
                        data.currentPin,
                        data.newPin
                    ),
                }))
            );

            // Update all seeds atomically
            await StorageUtil.updateAllEncryptedSeeds(blockchain, updatedSeeds);

            // Notify native app if running in native context
            if (isInNativeApp()) {
                sendPinChanged(true, data.newPin);
            }

            // Record successful attempt (resets counter)
            recordSuccessfulAttempt();
            setAttemptsLeft(5);

            // Show success in card
            setChangePinSuccess(true);

            // Reset form
            changePinForm.reset();
        } catch (error) {
            // Log internally but show generic message to user
            console.error("Error changing PIN:", error);
            setChangePinError("An unexpected error occurred while changing your PIN. Please try again.");
        } finally {
            setIsChangingPin(false);
        }
    }

    return (
        <>
            <SEO title="Settings" />
            <div className="flex w-full items-start justify-center py-2 md:py-8">
                <div className="relative w-full max-w-2xl px-2 md:px-4">
                    <div className="page-enter relative z-10 space-y-5 md:space-y-6">
                        {/* Security - web/native only. On desktop there is no
                            PIN (the signer uses a password / Argon2id) and no
                            in-renderer re-encrypt, so the section is hidden. */}
                        {hasEncryptedSeeds && !isDesktop && (
                            <SettingsSection title="Security">
                                <SettingsRow
                                    icon={Shield}
                                    tint="bg-primary/15 text-primary"
                                    title="Change PIN"
                                    subtitle="Change your wallet PIN used to encrypt your seeds"
                                    right={
                                        <>
                                            {/* Lockout state must be visible without expanding
                                                the panel. */}
                                            {pinLockout.isLocked ? (
                                                <span className="text-xs font-medium text-destructive">Locked</span>
                                            ) : hasFailedAttempts() && attemptsLeft < 5 ? (
                                                <span className="text-xs text-yellow-400">
                                                    {attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} left
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
                                    onClick={() => setShowPinForm((open) => !open)}
                                    // Collapsing mid-change would hide the outcome banner.
                                    disabled={isChangingPin}
                                    ariaExpanded={showPinForm}
                                    ariaControls="change-pin-panel"
                                />
                                {showPinForm && (
                                    <div id="change-pin-panel" className="px-4 pb-4 pt-3">
                                        <Form {...changePinForm}>
                                            <form
                                                onSubmit={changePinForm.handleSubmit(onChangePinSubmit)}
                                                className="space-y-4"
                                            >
                                                {pinLockout.isLocked && (
                                                    <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                                                        Too many failed attempts. Please wait {formatLockoutTime(pinLockout.remainingMs)}.
                                                    </div>
                                                )}
                                                {!pinLockout.isLocked && hasFailedAttempts() && attemptsLeft > 0 && (
                                                    <div className="rounded-md bg-yellow-500/15 p-3 text-sm text-yellow-400">
                                                        {attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} remaining before lockout.
                                                    </div>
                                                )}
                                                {changePinError && !pinLockout.isLocked && (
                                                    <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                                                        {changePinError}
                                                    </div>
                                                )}
                                                {changePinSuccess && (
                                                    <div className="rounded-md bg-success/15 p-3 text-sm text-success">
                                                        PIN changed successfully! Your wallet PIN has been updated.
                                                    </div>
                                                )}

                                                <FormField
                                                    control={changePinForm.control}
                                                    name="currentPin"
                                                    render={({ field, fieldState }) => (
                                                        <FormItem>
                                                            <FormLabel>Current PIN</FormLabel>
                                                            <FormControl>
                                                                <PinInput
                                                                    value={field.value}
                                                                    onChange={field.onChange}
                                                                    placeholder="Enter current PIN"
                                                                    error={fieldState.error?.message}
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
                                                            <FormLabel>New PIN</FormLabel>
                                                            <FormControl>
                                                                <PinInput
                                                                    ref={newPinRef}
                                                                    value={field.value}
                                                                    onChange={field.onChange}
                                                                    placeholder="Enter new PIN"
                                                                    error={fieldState.error?.message}
                                                                    disabled={isChangingPin || pinLockout.isLocked}
                                                                    onComplete={() => confirmPinRef.current?.focus()}
                                                                />
                                                            </FormControl>
                                                            <FormDescription>
                                                                PIN must be 4-6 digits
                                                            </FormDescription>
                                                        </FormItem>
                                                    )}
                                                />

                                                <FormField
                                                    control={changePinForm.control}
                                                    name="confirmNewPin"
                                                    render={({ field, fieldState }) => (
                                                        <FormItem>
                                                            <FormLabel>Confirm New PIN</FormLabel>
                                                            <FormControl>
                                                                <PinInput
                                                                    ref={confirmPinRef}
                                                                    value={field.value}
                                                                    onChange={field.onChange}
                                                                    placeholder="Confirm new PIN"
                                                                    error={fieldState.error?.message}
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
                                                    {isChangingPin ? "Changing PIN..." : "Change PIN"}
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
                                title="Preferences"
                                action={
                                    settingsSaveSuccess ? (
                                        <span
                                            role="status"
                                            className="flex items-center gap-1 text-xs text-success"
                                        >
                                            <Check className="h-3 w-3" />
                                            Saved
                                        </span>
                                    ) : undefined
                                }
                            >
                                {settingsSaveError && (
                                    <div role="alert" className="bg-destructive/10 px-4 py-2 text-xs text-destructive">
                                        {settingsSaveError}
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
                                                        Auto-lock Timer
                                                    </FormLabel>
                                                    <FormDescription className="mt-0.5 text-xs">
                                                        Lock the wallet after this many minutes of inactivity
                                                    </FormDescription>
                                                </div>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        max={60}
                                                        className="h-9 w-20 shrink-0 text-center"
                                                        {...field}
                                                        value={Number.isFinite(field.value) ? field.value : ""}
                                                        onChange={(e) => {
                                                            // Empty stays empty while typing (NaN fails
                                                            // validation, so nothing is written).
                                                            field.onChange(e.target.value === "" ? Number.NaN : Number(e.target.value));
                                                            queueSave(800);
                                                        }}
                                                        onBlur={() => {
                                                            field.onBlur();
                                                            const t = form.getValues("autoLockTimeout");
                                                            const invalid = !Number.isFinite(t) || t < 1 || t > 60;
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
                                                    Show Tokens Card
                                                </FormLabel>
                                                <FormDescription className="mt-0.5 text-xs">
                                                    Display the Tokens section on the Home page
                                                </FormDescription>
                                            </div>
                                            <FormControl>
                                                <Switch
                                                    checked={field.value ?? true}
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
                                                    Show NFTs Card
                                                </FormLabel>
                                                <FormDescription className="mt-0.5 text-xs">
                                                    Display the NFT collection section on the Home page
                                                </FormDescription>
                                            </div>
                                            <FormControl>
                                                <Switch
                                                    checked={field.value ?? true}
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

                        <SettingsSection title="Connections">
                            <SettingsRow
                                icon={BookUser}
                                tint="bg-secondary/15 text-secondary"
                                title="Address Book"
                                subtitle="Manage saved recipients for quick transfers"
                                right={<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                                onClick={() => navigate(ROUTES.ADDRESS_BOOK)}
                            />
                        </SettingsSection>

                        {/* dApp session management lives here (the list keeps
                            its own header + actions); the /dapp-sessions route
                            mounts the same component for deep links. Desktop
                            never reaches this page: its Settings entry opens
                            the native settings window (see utils/navigation). */}
                        <Card >
                            <DAppSessionsList />
                        </Card>
                    </div>
                </div>
            </div>
        </>
    );
});

export default Settings;
