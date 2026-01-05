import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/UI/Card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/UI/Form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/UI/Select";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import { Separator } from "@/components/UI/Separator";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import { StorageUtil } from "@/utils/storage";
import { zodResolver } from "@hookform/resolvers/zod";
import { utils } from "@theqrl/web3";
import { Loader, Send, X, Copy, Coins, ExternalLink } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { GasFeeNotice } from "./GasFeeNotice/GasFeeNotice";
import { TransactionSuccessful } from "./TransactionSuccessful/TransactionSuccessful";
import { getExplorerAddressUrl, getExplorerTxUrl, ZOND_PROVIDER } from "@/config";
import { Slider } from "@/components/UI/Slider";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import { WalletEncryptionUtil, getAddressFromMnemonic } from "@/utils/crypto";
import { SEO } from "@/components/SEO/SEO";
import { getOptimalTokenBalance } from "@/utils/formatting";
import { fetchBalance } from "@/utils/web3";
import { formatUnits, parseUnits } from "ethers";

const Transfer = observer(() => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { zondStore } = useStore();
  const {
    activeAccount,
    getAccountBalance,
    signAndSendTransaction,
    sendTransactionViaExtension,
    activeAccountSource,
    zondConnection,
    transactionStatus,
    resetTransactionStatus,
    tokenList,
    sendToken: sendTokenToStore,
  } = zondStore;
  const { blockchain } = zondConnection;
  const { accountAddress } = activeAccount;

  const isUsingExtension = activeAccountSource === 'extension';

  // Create FormSchema with PIN validation based on isUsingExtension
  const FormSchema = useMemo(() => z
    .object({
      asset: z.string().min(1, "Please select an asset"),
      receiverAddress: z.string().min(1, "Receiver address is required"),
      amount: z.coerce.number().gt(0, "Amount should be more than 0"),
      pin: z.string().optional(),
    })
    .superRefine((fields, ctx) => {
      // Validate address format
      if (fields.receiverAddress.trim()) {
        const address = fields.receiverAddress.trim();
        const isValidZondAddress = address.startsWith('Z') &&
          (address.length === 41 || address.length === 42);
        if (!isValidZondAddress) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid Zond address format",
            path: ["receiverAddress"]
          });
        }
      }

      // Validate PIN for non-extension accounts
      if (!isUsingExtension) {
        if (!fields.pin || fields.pin.length < 4 || fields.pin.length > 6) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "PIN must be between 4 to 6 digits",
            path: ["pin"]
          });
        }
      }
    }), [isUsingExtension]);

  // Get initial asset from URL params (for token transfers from home page)
  const initialAsset = searchParams.get('asset') || 'native';

  const [sliderValue, setSliderValue] = useState(0);
  const [amountInputValue, setAmountInputValue] = useState("");
  const [tokenBalance, setTokenBalance] = useState("0");
  const [hasJustCopied, setHasJustCopied] = useState(false);

  const form = useForm({
    resolver: zodResolver(FormSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      asset: initialAsset,
      receiverAddress: "",
      amount: 0,
      pin: "",
    },
  });

  const {
    reset,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { isSubmitting, isValid },
  } = form;

  const selectedAsset = watch("asset");
  const formValues = watch() as z.infer<typeof FormSchema>;
  const isNativeTransfer = selectedAsset === "native";

  // Get selected token info
  const selectedToken = !isNativeTransfer
    ? tokenList.find(t => t.address === selectedAsset)
    : null;

  // Get balance based on selected asset
  const accountBalance = isNativeTransfer
    ? getAccountBalance(accountAddress)
    : tokenBalance;

  // Fetch token balance when asset changes
  useEffect(() => {
    const fetchTokenBalance = async () => {
      if (!isNativeTransfer && selectedAsset && accountAddress) {
        try {
          const selectedBlockChain = await StorageUtil.getBlockChain();
          const balance = await fetchBalance(
            selectedAsset,
            accountAddress,
            ZOND_PROVIDER[selectedBlockChain as keyof typeof ZOND_PROVIDER].url
          );
          const token = tokenList.find(t => t.address === selectedAsset);
          setTokenBalance(formatUnits(balance, token?.decimals || 18));
        } catch (error) {
          console.error("Error fetching token balance:", error);
          setTokenBalance("0");
        }
      }
    };
    fetchTokenBalance();
  }, [selectedAsset, accountAddress, isNativeTransfer, tokenList]);

  // Reset amount when asset changes
  useEffect(() => {
    setAmountInputValue("");
    setSliderValue(0);
    setValue("amount", 0);
  }, [selectedAsset, setValue]);

  if (!accountAddress) {
    return (
      <>
        <SEO title="Transfer" />
        <div className="flex w-full items-start justify-center py-8 overflow-x-hidden">
          <div className="relative w-full max-w-2xl px-4">
            <img
              className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
              src="/tree.svg"
              alt="Background Tree"
            />
            <Card className="w-full border-l-4 border-l-secondary">
              <CardHeader className="bg-gradient-to-r from-secondary/5 to-transparent">
                <CardTitle className="text-2xl font-bold">Transfer</CardTitle>
                <CardDescription>
                  Send QRL or tokens to another wallet
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center p-8 text-center">
                  <p className="text-muted-foreground mb-4">
                    You need to import an account before making transfers.
                  </p>
                  <Button onClick={() => navigate(ROUTES.IMPORT_ACCOUNT)}>
                    Import Account
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </>
    );
  }

  const copyToClipboard = (text: string) => {
    setHasJustCopied(true);
    navigator.clipboard.writeText(text);
    setTimeout(() => setHasJustCopied(false), 1000);
  };

  const onViewInExplorer = () => {
    if (accountAddress) {
      window.open(getExplorerAddressUrl(accountAddress, blockchain), '_blank');
    }
  };

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    if (isNativeTransfer) {
      await handleNativeTransfer(formData);
    } else {
      await handleTokenTransfer(formData);
    }
  }

  async function handleNativeTransfer(formData: z.infer<typeof FormSchema>) {
    const valueEther = formData.amount.toString();

    if (isUsingExtension) {
      await sendTransactionViaExtension(formData.receiverAddress, valueEther);
      resetForm();
      window.scrollTo(0, 0);
    } else {
      try {
        const encryptedSeed = await StorageUtil.getEncryptedSeed(blockchain, accountAddress);
        if (!encryptedSeed) {
          control.setError("pin", { message: "No stored seed found. Please import your account again." });
          return;
        }

        let mnemonicPhrases;
        try {
          const decryptedSeed = WalletEncryptionUtil.decryptSeedWithPin(encryptedSeed, formData.pin!);
          mnemonicPhrases = decryptedSeed.mnemonic;
        } catch {
          control.setError("pin", { message: "Invalid PIN. Please try again." });
          return;
        }

        await signAndSendTransaction(accountAddress, formData.receiverAddress, valueEther, mnemonicPhrases);
        resetForm();
        window.scrollTo(0, 0);
      } catch (error) {
        control.setError("pin", { message: `Transaction failed: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }

  async function handleTokenTransfer(formData: z.infer<typeof FormSchema>) {
    if (!selectedToken) return;

    try {
      const encryptedSeed = await StorageUtil.getEncryptedSeed(blockchain, accountAddress);
      if (!encryptedSeed) {
        control.setError("pin", { message: "No stored seed found. Please import your account again." });
        return;
      }

      let mnemonic;
      try {
        const decryptedSeed = WalletEncryptionUtil.decryptSeedWithPin(encryptedSeed, formData.pin || "");
        mnemonic = decryptedSeed.mnemonic;
      } catch {
        control.setError("pin", { message: "Invalid PIN. Please try again." });
        return;
      }

      const senderAddress = getAddressFromMnemonic(mnemonic);
      if (senderAddress.toLowerCase() !== accountAddress.toLowerCase()) {
        control.setError("pin", { message: "PIN decrypted an invalid seed." });
        return;
      }

      const rawAmount = parseUnits(formData.amount.toString(), selectedToken.decimals).toString();
      await sendTokenToStore(selectedToken, rawAmount, mnemonic, formData.receiverAddress);
      resetForm();
      window.scrollTo(0, 0);
    } catch (error) {
      control.setError("pin", { message: `Transfer failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  const resetForm = () => {
    reset({ asset: selectedAsset, receiverAddress: "", amount: 0, pin: "" });
    setSliderValue(0);
    setAmountInputValue("");
  };

  const cancelTransaction = () => {
    resetForm();
    resetTransactionStatus();
    navigate(ROUTES.HOME);
  };

  const handleSliderChange = (value: number[]) => {
    const percentage = value[0];
    setSliderValue(percentage);
    if (accountBalance && accountBalance !== "0") {
      const maxAmount = parseFloat(accountBalance);
      const calculatedAmount = (maxAmount * (percentage / 100));
      const formattedAmount = calculatedAmount.toFixed(6).replace(/\.?0+$/, "");
      setAmountInputValue(formattedAmount);
      setValue("amount", parseFloat(formattedAmount));
    }
  };

  const setPercentage = (percentage: number) => () => {
    setSliderValue(percentage);
    if (accountBalance && accountBalance !== "0") {
      const maxAmount = parseFloat(accountBalance);
      const calculatedAmount = (maxAmount * (percentage / 100));
      const formattedAmount = calculatedAmount.toFixed(6).replace(/\.?0+$/, "");
      setAmountInputValue(formattedAmount);
      setValue("amount", parseFloat(formattedAmount));
    }
  };

  const prefix = accountAddress.substring(0, 1);
  const addressSplit: string[] = [];
  for (let i = 1; i < accountAddress.length; i += 4) {
    addressSplit.push(accountAddress.substring(i, i + 4));
  }

  const assetSymbol = isNativeTransfer ? "QRL" : (selectedToken?.symbol || "");

  // Transaction States
  if (transactionStatus.state === 'confirmed' && transactionStatus.receipt) {
    return (
      <TransactionSuccessful
        transactionReceipt={transactionStatus.receipt}
        onDone={() => {
          resetTransactionStatus();
          navigate(ROUTES.HOME);
        }}
      />
    );
  }

  if (transactionStatus.state === 'pending') {
    return (
      <div className="flex w-full items-start justify-center py-8 overflow-x-hidden">
        <div className="relative w-full max-w-2xl px-4">
          <Card className="w-full border-l-4 border-l-orange-500">
            <CardHeader className="bg-gradient-to-r from-orange-500/10 to-transparent">
              <CardTitle className="flex items-center gap-2">
                <Loader className="h-5 w-5 animate-spin" />
                Transaction Pending
              </CardTitle>
            </CardHeader>
            <CardContent className="py-8">
              <div className="flex flex-col items-center gap-4 text-center">
                <p className="text-muted-foreground">
                  Your transaction has been submitted and is awaiting confirmation.
                </p>
                {transactionStatus.txHash && (
                  <a
                    href={getExplorerTxUrl(transactionStatus.txHash, blockchain)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-secondary hover:text-secondary/80"
                  >
                    View on ZondScan <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                {transactionStatus.pendingDetails && (
                  <div className="mt-4 w-full max-w-md rounded border bg-muted p-4 text-left text-sm space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Value:</span>
                      <span>{utils.fromWei(BigInt(transactionStatus.pendingDetails.value), "ether")} QRL</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Gas Price:</span>
                      <span>{utils.fromWei(BigInt(transactionStatus.pendingDetails.gasPrice), "gwei")} Gwei</span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (transactionStatus.state === 'failed') {
    return (
      <div className="flex w-full items-start justify-center py-8 overflow-x-hidden">
        <div className="relative w-full max-w-2xl px-4">
          <Card className="w-full border-l-4 border-l-destructive">
            <CardHeader className="bg-gradient-to-r from-destructive/10 to-transparent">
              <CardTitle className="flex items-center gap-2 text-destructive">
                <X className="h-5 w-5" />
                Transaction Failed
              </CardTitle>
            </CardHeader>
            <CardContent className="py-8">
              <div className="flex flex-col items-center gap-4 text-center">
                <p className="text-destructive">{transactionStatus.error || "An unknown error occurred."}</p>
                {transactionStatus.txHash && (
                  <a
                    href={getExplorerTxUrl(transactionStatus.txHash, blockchain)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-secondary hover:text-secondary/80"
                  >
                    View on ZondScan <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="outline" onClick={resetTransactionStatus} className="w-full">
                Try Again
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  // Main Form
  return (
    <>
      <SEO title="Transfer" />
      <div className="flex w-full items-start justify-center py-8 overflow-x-hidden">
        <div className="relative w-full max-w-2xl px-4">
          <img
            className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
            src="/tree.svg"
            alt="Background Tree"
          />
          <Form {...form}>
            <form className="w-full" onSubmit={handleSubmit(onSubmit)}>
              <Card className="w-full border-l-4 border-l-secondary">
                <CardHeader className="bg-gradient-to-r from-secondary/5 to-transparent">
                  <CardTitle className="text-2xl font-bold">Transfer</CardTitle>
                  <CardDescription>
                    Send QRL or tokens to another wallet
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Asset Selector */}
                  <FormField
                    control={control}
                    name="asset"
                    render={({ field }) => (
                      <FormItem>
                        <Label>Asset</Label>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select asset to send" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="native">
                              <div className="flex items-center gap-2">
                                <Coins className="h-4 w-4" />
                                <span>QRL (Native)</span>
                              </div>
                            </SelectItem>
                            {tokenList.map((token) => (
                              <SelectItem key={token.address} value={token.address}>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{token.symbol}</span>
                                  <span className="text-muted-foreground">- {token.name}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Separator />

                  {/* From Address */}
                  <div className="flex flex-col gap-2">
                    <Label>From</Label>
                    <div className="font-bold text-secondary">
                      {`${prefix} ${addressSplit.join(" ")}`}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Available: {getOptimalTokenBalance(accountBalance)} {assetSymbol}
                    </div>
                    <div className="flex gap-4">
                      <Button
                        className="w-full"
                        type="button"
                        variant="outline"
                        onClick={() => copyToClipboard(accountAddress)}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        {hasJustCopied ? "Copied" : "Copy"}
                      </Button>
                      <Button
                        className="w-full"
                        type="button"
                        variant="outline"
                        onClick={onViewInExplorer}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        View in Zondscan
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  {/* To Address */}
                  <FormField
                    control={control}
                    name="receiverAddress"
                    render={({ field }) => (
                      <FormItem>
                        <Label>Send to</Label>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value ?? ""}
                            disabled={isSubmitting}
                            placeholder="Receiver address"
                          />
                        </FormControl>
                        <FormDescription>
                          Enter the receiver's account address
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Amount */}
                  <FormField
                    control={control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <Label>Amount</Label>
                              <span className="text-sm text-muted-foreground">
                                {getOptimalTokenBalance(accountBalance)} {assetSymbol} available
                              </span>
                            </div>
                            <Input
                              placeholder="Enter amount"
                              type="text"
                              inputMode="decimal"
                              disabled={isSubmitting}
                              value={amountInputValue}
                              onChange={(e) => {
                                const value = e.target.value.replace(",", ".");
                                if (value === "" || /^\d*\.?\d*$/.test(value)) {
                                  setAmountInputValue(value);
                                  const numValue = value === "" ? 0 : parseFloat(value) || 0;
                                  field.onChange(numValue);
                                  if (accountBalance && parseFloat(accountBalance) > 0) {
                                    const percentage = Math.min(100, (numValue / parseFloat(accountBalance)) * 100);
                                    setSliderValue(Math.round(percentage));
                                  }
                                }
                              }}
                            />
                          </div>
                        </FormControl>

                        <div className="mt-4 space-y-4">
                          <div className="flex justify-between">
                            <Label>Percentage of balance</Label>
                            <span className="text-sm text-muted-foreground">{sliderValue}%</span>
                          </div>

                          <Slider
                            value={[sliderValue]}
                            min={0}
                            max={100}
                            step={1}
                            onValueChange={handleSliderChange}
                            className="w-full"
                            disabled={isSubmitting}
                          />

                          <div className="flex justify-between gap-2">
                            {[25, 50, 75, 100].map((pct) => (
                              <Button
                                key={pct}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={setPercentage(pct)}
                                disabled={isSubmitting}
                                className="flex-1"
                              >
                                {pct === 100 ? "Max" : `${pct}%`}
                              </Button>
                            ))}
                          </div>
                        </div>

                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* PIN Input */}
                  {!isUsingExtension && (
                    <FormField
                      control={control}
                      name="pin"
                      render={({ field }) => (
                        <FormItem className="space-y-2">
                          <Label>Transaction PIN</Label>
                          <FormControl>
                            <PinInput
                              length={6}
                              onChange={field.onChange}
                              value={field.value || ''}
                              disabled={isSubmitting}
                            />
                          </FormControl>
                          <FormDescription>
                            Enter the PIN used to encrypt your wallet seed
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {/* Gas Fee Notice (only for native transfers) */}
                  {isNativeTransfer && (
                    <GasFeeNotice
                      from={accountAddress}
                      to={formValues.receiverAddress}
                      value={formValues.amount}
                      isSubmitting={isSubmitting}
                    />
                  )}
                </CardContent>
                <CardFooter className="grid grid-cols-2 gap-4">
                  <Button variant="outline" type="button" onClick={cancelTransaction}>
                    <X className="mr-2 h-4 w-4" />
                    Cancel
                  </Button>
                  <Button
                    disabled={isSubmitting || !isValid}
                    type="submit"
                  >
                    {isSubmitting ? (
                      <Loader className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Send {assetSymbol}
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </Form>
        </div>
      </div>
    </>
  );
});

export default Transfer;
