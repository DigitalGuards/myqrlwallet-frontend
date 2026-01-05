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
import { useState } from "react";
import { NetworkSettings } from "./NetworkSettings/NetworkSettings";
import { toast } from "@/hooks/use-toast";
import { StorageUtil } from "@/utils/storage";
import { Save } from "lucide-react";
import { SEO } from "@/components/SEO/SEO";

const SettingsFormSchema = z.object({
    autoLockTimeout: z.number().min(1).max(60),
    showTestNetworks: z.boolean(),
    hideSmallBalances: z.boolean(),
    hideUnknownTokens: z.boolean(),
});

type SettingsFormValues = z.infer<typeof SettingsFormSchema>;

const Settings = observer(() => {
    const [isSubmitting, setIsSubmitting] = useState(false);

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
        try {
            setIsSubmitting(true);
            // Convert minutes to milliseconds for storage
            const settingsToSave = {
                ...data,
                autoLockTimeout: data.autoLockTimeout * 60 * 1000
            };
            await StorageUtil.setWalletSettings(settingsToSave);
            toast({
                title: "Settings saved successfully",
                description: "Your wallet settings have been updated.",
            });
        } catch (_error) {
            toast({
                title: "Error saving settings",
                description: "There was an error saving your settings.",
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
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
