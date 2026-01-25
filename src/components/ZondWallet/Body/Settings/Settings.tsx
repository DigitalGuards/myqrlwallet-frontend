import { Button } from "../../../UI/Button";
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
    FormLabel,
    FormMessage,
} from "../../../UI/Form";
import { Input } from "../../../UI/Input";
import { Switch } from "@/components/UI/switch";
import { Separator } from "@/components/UI/Separator";
import { observer } from "mobx-react-lite";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useState, useEffect } from "react";
import { NetworkSettings } from "./NetworkSettings/NetworkSettings";
import { StorageUtil, EncryptedSeedData } from "@/utils/storage";
import { Save, Shield } from "lucide-react";
import { SEO } from "@/components/SEO/SEO";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import { decryptSeedAsync, reEncryptSeedAsync } from "@/utils/crypto";
import { isInNativeApp, sendPinChanged } from "@/utils/nativeApp";
import {
    checkLockout,
    recordFailedAttempt,
    recordSuccessfulAttempt,
    formatLockoutTime,
    getRemainingAttempts,
    hasFailedAttempts,
} from "@/utils/crypto/pinAttemptTracker";

const SettingsFormSchema = z.object({
    autoLockTimeout: z.number().min(1).max(60),
    showTestNetworks: z.boolean(),
    hideSmallBalances: z.boolean(),
    hideUnknownTokens: z.boolean(),
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
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [hasEncryptedSeeds, setHasEncryptedSeeds] = useState(false);
    const [isChangingPin, setIsChangingPin] = useState(false);
    const [changePinError, setChangePinError] = useState<string | null>(null);
    const [changePinSuccess, setChangePinSuccess] = useState(false);
    const [pinLockout, setPinLockout] = useState<{ isLocked: boolean; remainingMs: number }>({ isLocked: false, remainingMs: 0 });
    const [attemptsLeft, setAttemptsLeft] = useState(5);
    const [settingsSaveSuccess, setSettingsSaveSuccess] = useState(false);
    const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);

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

    const form = useForm<SettingsFormValues>({
        resolver: zodResolver(SettingsFormSchema),
        defaultValues: async () => {
            const settings = await StorageUtil.getWalletSettings();
            return {
                autoLockTimeout: settings.autoLockTimeout ? Math.floor(settings.autoLockTimeout / (60 * 1000)) : 15,
                showTestNetworks: settings.showTestNetworks || false,
                hideSmallBalances: settings.hideSmallBalances || false,
                hideUnknownTokens: settings.hideUnknownTokens || true,
            };
        },
    });

    async function onSubmit(data: SettingsFormValues) {
        setSettingsSaveSuccess(false);
        setSettingsSaveError(null);
        try {
            setIsSubmitting(true);
            // Convert minutes to milliseconds for storage
            const settingsToSave = {
                ...data,
                autoLockTimeout: data.autoLockTimeout * 60 * 1000
            };
            await StorageUtil.setWalletSettings(settingsToSave);
            setSettingsSaveSuccess(true);
        } catch (_error) {
            setSettingsSaveError("There was an error saving your settings.");
        } finally {
            setIsSubmitting(false);
        }
    }

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
                await decryptSeedAsync(allSeeds[0].encryptedSeed, data.currentPin);
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
            <div className="flex w-full items-start justify-center py-8">
                <div className="relative w-full max-w-2xl px-4">
                    { /* <video
                        autoPlay
                        muted
                        loop
                        playsInline
                        className={"fixed left-0 top-0 z-0 h-96 w-96 -translate-x-8 scale-150 overflow-hidden"}
                    >
                        <source src="/tree.mp4" type="video/mp4" />
                    </video> */ }
                    <div className="relative z-10 space-y-8">
                        {/* PIN Management Card - only visible when user has encrypted seeds */}
                        {hasEncryptedSeeds && (
                            <Card className="border-l-4 border-l-orange-500">
                                <CardHeader className="bg-gradient-to-r from-orange-500/5 to-transparent">
                                    <div className="flex items-center gap-2">
                                        <Shield className="h-6 w-6 text-orange-500" />
                                        <CardTitle className="text-2xl font-bold">PIN Management</CardTitle>
                                    </div>
                                    <CardDescription>
                                        Change your wallet PIN used to encrypt your seeds
                                    </CardDescription>
                                </CardHeader>

                                <Form {...changePinForm}>
                                    <form onSubmit={changePinForm.handleSubmit(onChangePinSubmit)}>
                                        <CardContent className="space-y-6">
                                            {pinLockout.isLocked && (
                                                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                                                    Too many failed attempts. Please wait {formatLockoutTime(pinLockout.remainingMs)}.
                                                </div>
                                            )}
                                            {!pinLockout.isLocked && hasFailedAttempts() && attemptsLeft > 0 && (
                                                <div className="rounded-md bg-yellow-500/15 p-3 text-sm text-yellow-600 dark:text-yellow-400">
                                                    {attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} remaining before lockout.
                                                </div>
                                            )}
                                            {changePinError && !pinLockout.isLocked && (
                                                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                                                    {changePinError}
                                                </div>
                                            )}
                                            {changePinSuccess && (
                                                <div className="rounded-md bg-green-500/15 p-3 text-sm text-green-600 dark:text-green-400">
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
                                                                value={field.value}
                                                                onChange={field.onChange}
                                                                placeholder="Enter new PIN"
                                                                error={fieldState.error?.message}
                                                                disabled={isChangingPin || pinLockout.isLocked}
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
                                        </CardContent>

                                        <CardFooter>
                                            <Button
                                                type="submit"
                                                className="w-full"
                                                disabled={isChangingPin || pinLockout.isLocked}
                                            >
                                                <Shield className="mr-2 h-4 w-4" />
                                                {isChangingPin ? "Changing PIN..." : "Change PIN"}
                                            </Button>
                                        </CardFooter>
                                    </form>
                                </Form>
                            </Card>
                        )}

                        <NetworkSettings />

                        <Card className="border-l-4 border-l-blue-accent">
                            <CardHeader className="bg-gradient-to-r from-blue-accent/5 to-transparent">
                                <CardTitle className="text-2xl font-bold">Wallet Preferences</CardTitle>
                                <CardDescription>
                                    Customize your wallet experience and security settings
                                </CardDescription>
                            </CardHeader>

                            <Form {...form}>
                                <form onSubmit={form.handleSubmit(onSubmit)}>
                                    <CardContent className="space-y-8">
                                        {settingsSaveSuccess && (
                                            <div role="status" className="rounded-md bg-green-500/15 p-3 text-sm text-green-600 dark:text-green-400">
                                                Settings saved successfully! Your wallet settings have been updated.
                                            </div>
                                        )}
                                        {settingsSaveError && (
                                            <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                                                {settingsSaveError}
                                            </div>
                                        )}
                                        <FormField
                                            control={form.control}
                                            name="autoLockTimeout"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Auto-lock Timer (minutes)</FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            type="number"
                                                            min={1}
                                                            max={60}
                                                            {...field}
                                                            value={field.value ?? 15}
                                                            onChange={(e) => field.onChange(Number(e.target.value))}
                                                        />
                                                    </FormControl>
                                                    <FormDescription>
                                                        Automatically lock your wallet after specified minutes of inactivity
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <Separator />

                                        <FormField
                                            control={form.control}
                                            name="showTestNetworks"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                                    <div className="space-y-0.5">
                                                        <FormLabel>Show Test Networks</FormLabel>
                                                        <FormDescription>
                                                            Display test networks in the network selection
                                                        </FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            checked={field.value ?? false}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="hideSmallBalances"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                                    <div className="space-y-0.5">
                                                        <FormLabel>Hide Small Balances</FormLabel>
                                                        <FormDescription>
                                                            Hide tokens with very small balances
                                                        </FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            checked={field.value ?? false}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="hideUnknownTokens"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                                    <div className="space-y-0.5">
                                                        <FormLabel>Hide Unknown Tokens</FormLabel>
                                                        <FormDescription>
                                                            Hide tokens that haven't been verified or added manually
                                                        </FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            checked={field.value ?? true}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </CardContent>

                                    <CardFooter>
                                        <Button
                                            type="submit"
                                            className="w-full"
                                            disabled={isSubmitting}
                                        >
                                            <Save className="mr-2 h-4 w-4" />
                                            Save Settings
                                        </Button>
                                    </CardFooter>
                                </form>
                            </Form>
                        </Card>
                    </div>
                </div>
            </div>
        </>
    );
});

export default Settings;
