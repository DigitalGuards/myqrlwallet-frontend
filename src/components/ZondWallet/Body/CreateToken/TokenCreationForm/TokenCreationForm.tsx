import { Checkbox } from "@/components/UI/CheckBox";
import { Button } from "../../../../UI/Button";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "../../../../UI/Card";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormMessage,
} from "../../../../UI/Form";
import { Input } from "../../../../UI/Input";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useEffect, useState } from "react";
import { useStore } from "@/stores/store";
import { toast } from "@/hooks/use-toast";
import { ethers } from "ethers";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/router/router";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import { WalletEncryptionUtil } from "@/utilities/walletEncryptionUtil";
import StorageUtil from "@/utilities/storageUtil";
import { getAddressFromMnemonic } from "@/functions/getHexSeedFromMnemonic";
import { Label } from "@/components/UI/Label";

const FormSchema = z
    .object({
        tokenName: z.string().min(1, { message: "Token name is required" }),
        tokenSymbol: z.string().min(1, { message: "Token symbol is required" }),
        initialSupply: z.string(),
        decimals: z.number().min(1, { message: "Decimals is required" }),
        mintable: z.boolean(),
        maxSupply: z.string().optional(),
        changeInitialRecipient: z.boolean(),
        recipientAddress: z.string().optional(),
        changeTokenOwner: z.boolean(),
        ownerAddress: z.string().optional(),
        setMaxWalletAmount: z.boolean(),
        maxWalletAmount: z.string().optional(),
        setMaxTransactionLimit: z.boolean(),
        maxTransactionLimit: z.string().optional(),
    });

type TokenCreationFormProps = {
    onTokenCreated: (tokenName: string, tokenSymbol: string, initialSupply: string, decimals: number, maxSupply: undefined | string, initialRecipient: undefined | string, tokenOwner: undefined | string, maxWalletAmount: undefined | string, maxTransactionLimit: undefined | string, mnemonicPhrases: string) => Promise<void>;
};

export const TokenCreationForm = observer(
    ({ onTokenCreated }: TokenCreationFormProps) => {
        const navigate = useNavigate();
        const { zondStore } = useStore();
        const { createdToken, addToken, activeAccount, activeAccountSource } = zondStore;
        const { name, symbol, decimals, address } = createdToken;
        const [pin, setPin] = useState("");
        const [pinError, setPinError] = useState("");

        const form = useForm<z.infer<typeof FormSchema>>({
            resolver: zodResolver(FormSchema),
            mode: "onChange",
            reValidateMode: "onSubmit",
            defaultValues: {
                tokenName: "",
                tokenSymbol: "",
                initialSupply: "0",
                decimals: 18,
                mintable: false,
                changeInitialRecipient: false,
                changeTokenOwner: false,
                setMaxWalletAmount: false,
                setMaxTransactionLimit: false,
            },
        });
        const {
            handleSubmit,
            control,
            formState: { isSubmitting, isValid },
        } = form;
        
        const isUsingExtension = activeAccountSource === 'extension';

        const formatRealValue = (supply: string, decimals: number) => {
            try {
                return ethers.formatUnits(supply, decimals);
            } catch (error) {
                return "Invalid value";
            }
        };

        async function onSubmit(formData: z.infer<typeof FormSchema>) {
            try {
                setPinError("");
                
                // Check if account exists
                if (!activeAccount.accountAddress) {
                    toast({
                        title: "No active account",
                        description: "Please import an account first",
                        variant: "destructive",
                    });
                    navigate(ROUTES.IMPORT_ACCOUNT);
                    return;
                }
                
                // For extension wallets, we need to handle differently
                if (isUsingExtension) {
                    toast({
                        title: "Extension wallet detected",
                        description: "Token creation with extension wallets is not yet supported. Please use an imported seed account.",
                        variant: "destructive",
                    });
                    return;
                }
                
                // Get encrypted seed and validate PIN (only for seed accounts)
                let mnemonicPhrase = "";
                if (!isUsingExtension) {
                    if (!pin) {
                        setPinError("PIN is required");
                        return;
                    }
                    
                    const selectedBlockChain = await StorageUtil.getBlockChain();
                    const encryptedSeed = await StorageUtil.getEncryptedSeed(selectedBlockChain, activeAccount.accountAddress);
                    
                    if (!encryptedSeed) {
                        setPinError("No stored seed found for this account. Please import your account again to set up a PIN.");
                        return;
                    }
                    
                    // Decrypt the seed using the PIN
                    try {
                        const decryptedSeed = WalletEncryptionUtil.decryptSeedWithPin(encryptedSeed, pin);
                        mnemonicPhrase = decryptedSeed.mnemonic;
                        
                        // Verify the mnemonic corresponds to the active account
                        const address = getAddressFromMnemonic(mnemonicPhrase);
                        if (address.toLowerCase() !== activeAccount.accountAddress.toLowerCase()) {
                            setPinError("PIN decrypted an invalid seed. Please import your account again.");
                            return;
                        }
                    } catch (error) {
                        setPinError("Invalid PIN. Please try again.");
                        return;
                    }
                }
                
                const tokenName = formData.tokenName;
                const tokenSymbol = formData.tokenSymbol;
                const initialSupply = ethers.parseUnits(formData.initialSupply, formData.decimals).toString();
                const decimals = formData.decimals;
                const maxSupply = formData.maxSupply ? ethers.parseUnits(formData.maxSupply, decimals).toString() : undefined;
                const recipientAddress = formData.recipientAddress;
                const ownerAddress = formData.ownerAddress;
                const maxWalletAmount = formData.maxWalletAmount ? ethers.parseUnits(formData.maxWalletAmount, decimals).toString() : undefined;
                const maxTransactionLimit = formData.maxTransactionLimit;
                
                onTokenCreated(tokenName, tokenSymbol, initialSupply, decimals, maxSupply, recipientAddress, ownerAddress, maxWalletAmount, maxTransactionLimit, mnemonicPhrase);
                navigate(ROUTES.TOKEN_STATUS);
            } catch (error) {
                console.error("Error creating token:", error);
                toast({
                    title: "Error creating token",
                    description: "Please try again",
                    variant: "destructive",
                });
            }
        }

        useEffect(() => {
            const init = async () => {
                form.reset({
                    tokenName: "",
                    tokenSymbol: "",
                    initialSupply: "0",
                    decimals: 18,
                    mintable: false,
                    changeInitialRecipient: false,
                    changeTokenOwner: false,
                    setMaxWalletAmount: false,
                    setMaxTransactionLimit: false,
                });
                if (address) {
                    const token = await addToken({
                        name: name,
                        symbol: symbol,
                        decimals: decimals,
                        address: address,
                        amount: "0",
                    });
                    if (token) {
                        toast({
                            title: `${name} token created successfully`,
                            description: `Address: ${address}\n Name: ${name}\n Symbol: ${symbol}\n Decimals: ${decimals}`,
                            variant: "default",
                        });
                    }
                }

            }
            init();
        }, [address]);

        // Check if user has an active account
        if (!activeAccount.accountAddress) {
            return (
                <Card className="border-l-4 border-l-secondary">
                    <CardHeader className="bg-gradient-to-r from-secondary/5 to-transparent">
                        <CardTitle className="text-2xl font-bold">Create New Token</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-col items-center justify-center p-8 text-center">
                            <p className="text-muted-foreground mb-4">
                                You need to import an account before creating tokens.
                            </p>
                            <Button onClick={() => navigate(ROUTES.IMPORT_ACCOUNT)}>
                                Import Account
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            );
        }

        return (
            <Form {...form}>
                <form className="w-full" onSubmit={handleSubmit(onSubmit)}>
                    <Card className="border-l-4 border-l-secondary">
                        <CardHeader className="bg-gradient-to-r from-secondary/5 to-transparent">
                            <CardTitle className="text-2xl font-bold">Create New ZRC20 Token</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-8">
                            <FormField
                                control={control}
                                name="tokenName"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input
                                                disabled={isSubmitting}
                                                placeholder="Example: DigitalGuards"
                                                type="text"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormDescription>Token Name</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="tokenSymbol"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input
                                                {...field}
                                                disabled={isSubmitting}
                                                placeholder="Example: DG"
                                                type="text"
                                            />
                                        </FormControl>
                                        <FormDescription>Token Symbol</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="initialSupply"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input
                                                {...field}
                                                disabled={isSubmitting}
                                                placeholder="Example: 1000000000"
                                                type="number"
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            {/* Initial Supply (Real Value: {formatRealValue(field.value || "0", form.watch("decimals"))}) */}
                                            Initial Supply
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="decimals"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input
                                                {...field}
                                                disabled={isSubmitting}
                                                placeholder="Example: 18"
                                                type="number"
                                                onChange={(e) => field.onChange(Number(e.target.value))}
                                            />
                                        </FormControl>
                                        <FormDescription>Decimals</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="mintable"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    disabled={isSubmitting}
                                                    id="mintable"
                                                />
                                                <label
                                                    htmlFor="mintable"
                                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                >
                                                    Mintable
                                                </label>
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            {form.watch("mintable") && (
                                <FormField
                                    control={control}
                                    name="maxSupply"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    disabled={isSubmitting}
                                                    placeholder="Example: 999,999,999,999,999,999"
                                                    type="string"
                                                />
                                            </FormControl>
                                            <FormDescription>
                                                Max Supply (Real Value: {formatRealValue(field.value || "0", form.watch("decimals"))})
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}
                            <FormField
                                control={control}
                                name="changeInitialRecipient"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    disabled={isSubmitting}
                                                    id="changeInitialRecipient"
                                                />
                                                <label
                                                    htmlFor="changeInitialRecipient"
                                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                >
                                                    Change Initial recipient
                                                </label>
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            {form.watch("changeInitialRecipient") && (
                                <FormField
                                    control={control}
                                    name="recipientAddress"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    disabled={isSubmitting}
                                                    placeholder="Example: Z20b4fb2929cfBe8b002b8A0c572551F755e54aEF"
                                                    type="string"
                                                />
                                            </FormControl>
                                            <FormDescription>Recipient Address</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}
                            <FormField
                                control={control}
                                name="changeTokenOwner"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    disabled={isSubmitting}
                                                    id="changeTokenOwner"
                                                />
                                                <label
                                                    htmlFor="changeTokenOwner"
                                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                >
                                                    Change Token Owner
                                                </label>
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            {form.watch("changeTokenOwner") && (
                                <FormField
                                    control={control}
                                    name="ownerAddress"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    disabled={isSubmitting}
                                                    placeholder="Example: Z20b4fb2929cfBe8b002b8A0c572551F755e54aEF"
                                                    type="string"
                                                />
                                            </FormControl>
                                            <FormDescription>Owner Address</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}
                            <FormField
                                control={control}
                                name="setMaxWalletAmount"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    disabled={isSubmitting}
                                                    id="setMaxWalletAmount"
                                                />
                                                <label
                                                    htmlFor="setMaxWalletAmount"
                                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                >
                                                    Max Wallet Amount
                                                </label>
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            {form.watch("setMaxWalletAmount") && (
                                <FormField
                                    control={control}
                                    name="maxWalletAmount"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    disabled={isSubmitting}
                                                    placeholder="Example: 999,999,999,999,999,999"
                                                    type="number"
                                                />
                                            </FormControl>
                                            <FormDescription>Max Wallet Amount</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}
                            <FormField
                                control={control}
                                name="setMaxTransactionLimit"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    disabled={isSubmitting}
                                                    id="setMaxTransactionLimit"
                                                />
                                                <label
                                                    htmlFor="setMaxTransactionLimit"
                                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                >
                                                    Max Transaction Limit
                                                </label>
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            {form.watch("setMaxTransactionLimit") && (
                                <FormField
                                    control={control}
                                    name="maxTransactionLimit"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    disabled={isSubmitting}
                                                    placeholder="Example: 999,999,999,999,999,999"
                                                    type="number"
                                                />
                                            </FormControl>
                                            <FormDescription>Max Transaction Limit</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}

                            {isUsingExtension ? (
                                <div className="flex flex-col p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                                        Token creation is currently only supported for imported seed accounts. 
                                        Please import an account with a seed phrase to create tokens.
                                    </p>
                                </div>
                            ) : (
                                <div className="flex flex-col">
                                    <Label htmlFor="pin" className="mb-2">
                                        Transaction PIN
                                    </Label>
                                    <PinInput
                                        length={6}
                                        placeholder="Enter your PIN"
                                        value={pin}
                                        onChange={setPin}
                                        disabled={isSubmitting}
                                        description="Enter your PIN to authorize token creation"
                                        error={pinError}
                                        autoFocus
                                    />
                                </div>
                            )}

                        </CardContent>
                        <CardFooter>
                            <Button
                                disabled={!isValid || isSubmitting || (!isUsingExtension && pin.length === 0) || isUsingExtension}
                                className="w-full"
                                type="submit"
                            >
                                {isSubmitting ? (
                                    <Loader className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <></>
                                )}
                                Create Token
                            </Button>
                        </CardFooter>
                    </Card>
                </form>
            </Form>
        );
    }
);
