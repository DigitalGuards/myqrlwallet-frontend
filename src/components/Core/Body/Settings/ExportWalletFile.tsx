import { Button } from "../../../UI/Button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
} from "../../../UI/Form";
import { Input } from "../../../UI/Input";
import { observer } from "mobx-react-lite";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useState, useEffect } from "react";
import { ChevronDown, FileDown } from "lucide-react";
import { StorageUtil } from "@/utils/storage";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import {
    WalletEncryptionUtil,
    decryptStoredSeedAsync,
    getAddressFromMnemonicAsync,
    CryptoOperationError,
    CryptoErrorCode,
    type ExtendedWalletAccount,
} from "@/utils/crypto";
import { isInNativeApp } from "@/utils/nativeApp";
import { useStore } from "../../../../stores/store";
import { cn } from "@/utils/cn";
import { SettingsRow } from "./SettingsList";
import {
    checkLockout,
    recordFailedAttempt,
    recordSuccessfulAttempt,
    formatLockoutTime,
} from "@/utils/crypto/pinAttemptTracker";

const ExportSchema = z.object({
    pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits"),
    filePassword: z.string().refine((value) => WalletEncryptionUtil.validatePassword(value), {
        message:
            "Password must be at least 8 characters with uppercase, lowercase, number, and special character",
    }),
    confirmFilePassword: z.string(),
}).refine((data) => data.filePassword === data.confirmFilePassword, {
    message: "Passwords must match",
    path: ["confirmFilePassword"],
});

type ExportFormValues = z.infer<typeof ExportSchema>;

/**
 * Settings row + collapsible panel: export the ACTIVE account as an encrypted
 * wallet file. The PIN both authorizes the export and is mechanically required
 * to decrypt the stored seed; the file itself is encrypted under a separate
 * strong password (a 4-6 digit PIN is far too weak to protect a file that
 * leaves the browser). The exported v2 format is importable by this wallet
 * and by the MyQRLWallet browser extension.
 */
export const ExportWalletFile = observer(() => {
    const { qrlStore } = useStore();
    const activeAddress = qrlStore.activeAccount.accountAddress;

    const [showPanel, setShowPanel] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [exportSuccess, setExportSuccess] = useState(false);
    const [pinLockout, setPinLockout] = useState<{ isLocked: boolean; remainingMs: number }>({ isLocked: false, remainingMs: 0 });

    // Shared lockout tracker with the Change PIN form: any wrong PIN counts.
    useEffect(() => {
        setPinLockout(checkLockout());
        const interval = setInterval(() => {
            setPinLockout(checkLockout());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const form = useForm<ExportFormValues>({
        resolver: zodResolver(ExportSchema),
        defaultValues: {
            pin: "",
            filePassword: "",
            confirmFilePassword: "",
        },
    });

    async function onSubmit(data: ExportFormValues) {
        const lockoutStatus = checkLockout();
        if (lockoutStatus.isLocked) {
            setExportError(`Too many failed attempts. Please wait ${formatLockoutTime(lockoutStatus.remainingMs)}.`);
            return;
        }

        setIsExporting(true);
        setExportError(null);
        setExportSuccess(false);

        try {
            if (!activeAddress) {
                setExportError("No active account to export.");
                return;
            }
            const blockchain = await StorageUtil.getBlockChain();
            const seeds = await StorageUtil.getAllEncryptedSeeds(blockchain);
            const entry = seeds.find(
                (seed) => seed.address.toLowerCase() === activeAddress.toLowerCase(),
            );
            if (!entry) {
                setExportError(
                    "The active account has no PIN-stored seed on this device, so there is nothing to export. Extension-connected accounts are exported from the extension itself.",
                );
                return;
            }

            let decrypted: { mnemonic: string; hexSeed: string };
            try {
                decrypted = await decryptStoredSeedAsync(
                    blockchain,
                    entry.address,
                    entry.encryptedSeed,
                    data.pin,
                );
            } catch (error) {
                if (
                    error instanceof CryptoOperationError &&
                    error.code === CryptoErrorCode.INCORRECT_PIN
                ) {
                    const result = recordFailedAttempt();
                    setPinLockout({ isLocked: result.isLocked, remainingMs: result.remainingMs });
                    setExportError(
                        result.isLocked
                            ? `Too many failed attempts. Please wait ${formatLockoutTime(result.remainingMs)}.`
                            : `Incorrect PIN. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} remaining.`,
                    );
                } else if (
                    error instanceof CryptoOperationError &&
                    error.code === CryptoErrorCode.OUTDATED_FORMAT
                ) {
                    setExportError("This wallet was saved in an older format and must be re-imported before it can be exported.");
                } else if (
                    error instanceof CryptoOperationError &&
                    error.code === CryptoErrorCode.DEVICE_CREDENTIAL_UNAVAILABLE
                ) {
                    setExportError("This wallet's device security credential is unavailable. Re-import the seed to restore access.");
                } else {
                    setExportError("Failed to unlock the seed. Please try again.");
                }
                return;
            }

            recordSuccessfulAttempt();

            const qrlInstance = qrlStore.qrlInstance;
            if (!qrlInstance) {
                setExportError("Wallet connection is unavailable. Please reconnect and try again.");
                return;
            }
            const derivedAddress = await getAddressFromMnemonicAsync(
                decrypted.mnemonic,
                qrlInstance,
            );
            if (derivedAddress.toLowerCase() !== entry.address.toLowerCase()) {
                setExportError("Security error: the stored seed does not match this account. Re-import the account before exporting.");
                return;
            }

            const account = {
                address: entry.address,
                mnemonic: decrypted.mnemonic,
                hexSeed: decrypted.hexSeed,
            } as ExtendedWalletAccount;
            await WalletEncryptionUtil.downloadWallet(account, data.filePassword);

            setExportSuccess(true);
            form.reset();
        } catch (error) {
            console.error("Error exporting wallet file:", error);
            setExportError("An unexpected error occurred while exporting the wallet file.");
        } finally {
            setIsExporting(false);
        }
    }

    return (
        <>
            <SettingsRow
                icon={FileDown}
                tint="bg-teal-500/15 text-teal-400"
                title="Export Wallet File"
                subtitle="Download the active account as an encrypted wallet file"
                right={
                    <ChevronDown
                        className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            showPanel && "rotate-180",
                        )}
                    />
                }
                onClick={() => setShowPanel((open) => !open)}
                disabled={isExporting}
                ariaExpanded={showPanel}
                ariaControls="export-wallet-panel"
            />
            {showPanel && (
                <div id="export-wallet-panel" className="px-4 pb-4 pt-3">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <p className="text-xs text-muted-foreground">
                                Exports{" "}
                                <span className="font-data break-all">{activeAddress || "the active account"}</span>{" "}
                                as an encrypted wallet file readable by this wallet and the
                                MyQRLWallet browser extension. Confirm with your PIN, then set
                                a strong password for the file itself.
                            </p>

                            {pinLockout.isLocked && (
                                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                                    Too many failed attempts. Please wait {formatLockoutTime(pinLockout.remainingMs)}.
                                </div>
                            )}
                            {exportError && !pinLockout.isLocked && (
                                <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                                    {exportError}
                                </div>
                            )}
                            {exportSuccess && (
                                <div role="status" className="rounded-md bg-success/15 p-3 text-sm text-success">
                                    {isInNativeApp()
                                        ? "Wallet file handed to the share sheet. Save it somewhere safe."
                                        : "Encrypted wallet file downloaded. Store it somewhere safe."}
                                </div>
                            )}

                            <FormField
                                control={form.control}
                                name="pin"
                                render={({ field, fieldState }) => (
                                    <FormItem>
                                        <FormLabel>Wallet PIN</FormLabel>
                                        <FormControl>
                                            <PinInput
                                                value={field.value}
                                                onChange={field.onChange}
                                                placeholder="Enter your PIN"
                                                error={fieldState.error?.message}
                                                disabled={isExporting || pinLockout.isLocked}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="filePassword"
                                render={({ field, fieldState }) => (
                                    <FormItem>
                                        <FormLabel>File Password</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="password"
                                                autoComplete="new-password"
                                                disabled={isExporting || pinLockout.isLocked}
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            At least 8 characters with uppercase, lowercase, number, and special character
                                        </FormDescription>
                                        {fieldState.error && (
                                            <p className="text-sm font-medium text-destructive">{fieldState.error.message}</p>
                                        )}
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="confirmFilePassword"
                                render={({ field, fieldState }) => (
                                    <FormItem>
                                        <FormLabel>Confirm File Password</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="password"
                                                autoComplete="new-password"
                                                disabled={isExporting || pinLockout.isLocked}
                                                {...field}
                                            />
                                        </FormControl>
                                        {fieldState.error && (
                                            <p className="text-sm font-medium text-destructive">{fieldState.error.message}</p>
                                        )}
                                    </FormItem>
                                )}
                            />

                            <Button
                                type="submit"
                                className="w-full"
                                disabled={isExporting || pinLockout.isLocked}
                            >
                                <FileDown className="mr-2 h-4 w-4" />
                                {isExporting ? "Exporting..." : "Export Wallet File"}
                            </Button>
                        </form>
                    </Form>
                </div>
            )}
        </>
    );
});
