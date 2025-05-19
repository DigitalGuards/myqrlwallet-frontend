import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/UI/Form";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import { Separator } from "@/components/UI/Separator";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { zodResolver } from "@hookform/resolvers/zod";
import { utils } from "@theqrl/web3";
import { Loader, Send, X, Check, Copy } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { GasFeeNotice } from "./GasFeeNotice/GasFeeNotice";
import { TransactionSuccessful } from "./TransactionSuccessful/TransactionSuccessful";
import { getExplorerAddressUrl, getExplorerTxUrl } from "@/configuration/zondConfig";
import { ExternalLink } from "lucide-react";
import { formatBalance } from "@/utilities/helper";
import { Slider } from "@/components/UI/Slider";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import { WalletEncryptionUtil } from "@/utilities/walletEncryptionUtil";
import { SEO } from "@/components/SEO/SEO";

const FormSchema = z
  .object({
    receiverAddress: z.string().min(1, "Receiver address is required"),
    amount: z.coerce.number().gt(0, "Amount should be more than 0"),
    mnemonicPhrases: z.string().optional(),
  })
  .superRefine((fields, ctx) => {
    // Skip empty addresses - they'll be caught by the required validator
    if (!fields.receiverAddress.trim()) return;
    
    // Validate Zond address format (starts with Z and has correct length)
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
  });

const AccountDetails = observer(() => {
  const navigate = useNavigate();
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
  } = zondStore;
  const { blockchain } = zondConnection;
  const { accountAddress } = activeAccount;

  const [sliderValue, setSliderValue] = useState(0);

  const [hasJustCopied, setHasJustCopied] = useState(false);
  const [timer, setTimer] = useState<NodeJS.Timeout>();

  useEffect(() => {
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [timer]);

  useEffect(() => {
    // Check if we have an encrypted seed for this account
    const checkForEncryptedSeed = async () => {
      try {
        await StorageUtil.getEncryptedSeed(blockchain, accountAddress);
        // We don't need to track this state anymore since we always use PIN
      } catch (error) {
        console.log("No encrypted seed found for this account");
      }
    };
    
    checkForEncryptedSeed();
    
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [timer, blockchain, accountAddress]);

  const onViewInExplorer = () => {
    if (accountAddress) {
      window.open(getExplorerAddressUrl(accountAddress, blockchain), '_blank');
    }
  };

  // Generalized copy function
  const copyToClipboard = (text: string) => {
    setHasJustCopied(true);
    navigator.clipboard.writeText(text);
    const newTimer = setTimeout(() => {
      setHasJustCopied(false);
    }, 1000);
    setTimer(newTimer);
  };

  const isUsingExtension = activeAccountSource === 'extension';

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    const valueEther = formData.amount.toString();

    if (isUsingExtension) {
      console.log("Submitting transaction via extension...");
      await sendTransactionViaExtension(
        formData.receiverAddress,
        valueEther
      );
      StorageUtil.clearTransactionValues(blockchain);
      resetForm();
      window.scrollTo(0, 0);
    } else {
      console.log("Submitting transaction via local signing...");
      if (!formData.mnemonicPhrases || formData.mnemonicPhrases.length < 4 || formData.mnemonicPhrases.length > 6) {
        control.setError("mnemonicPhrases", {
          message: "PIN must be between 4 to 6 digits for local accounts.",
        });
        return;
      }
      
      try {
        const encryptedSeed = await StorageUtil.getEncryptedSeed(blockchain, accountAddress);
        
        if (!encryptedSeed) {
          control.setError("mnemonicPhrases", {
            message: "No stored seed found for this account. Please import your account again to set up a PIN.",
          });
          return;
        }
        
        let mnemonicPhrases;
        try {
          const decryptedSeed = WalletEncryptionUtil.decryptSeedWithPin(encryptedSeed, formData.mnemonicPhrases);
          mnemonicPhrases = decryptedSeed.mnemonic;
        } catch (error) {
          control.setError("mnemonicPhrases", {
            message: "Invalid PIN. Please try again.",
          });
          return;
        }

        await signAndSendTransaction(
          accountAddress,
          formData.receiverAddress,
          formData.amount,
          mnemonicPhrases
        );

        StorageUtil.clearTransactionValues(blockchain);
        resetForm();
        window.scrollTo(0, 0);

      } catch (error) {
        control.setError("mnemonicPhrases", {
          message: `An error occurred during local signing. ${error}`,
        });
      }
    }
  }

  const resetForm = () => {
    reset({ receiverAddress: "", amount: 0, mnemonicPhrases: "" }, { keepErrors: true });
    setSliderValue(0);
  };

  const cancelTransaction = () => {
    resetForm();
    setSliderValue(0);
    resetTransactionStatus();
    navigate(ROUTES.HOME);
  };

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: async () => {
      const values = await StorageUtil.getTransactionValues(blockchain);
      return {
        receiverAddress: values.receiverAddress || "",
        amount: values.amount || 0,
        mnemonicPhrases: "",
      };
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

  const formValues = watch();

  const accountBalance = getAccountBalance(accountAddress);

  const prefix = accountAddress.substring(0, 1);
  const addressSplit: string[] = [];
  for (let i = 1; i < accountAddress.length; i += 4) {
    addressSplit.push(accountAddress.substring(i, i + 4));
  }

  // Handle slider change to update amount
  const handleSliderChange = (value: number[]) => {
    const percentage = value[0];
    setSliderValue(percentage);
    
    if (accountBalance && accountBalance !== "0") {
      const maxAmount = parseFloat(accountBalance);
      const calculatedAmount = (maxAmount * (percentage / 100));
      const formattedAmount = calculatedAmount.toFixed(6).replace(/\.?0+$/, "");
      setValue("amount", parseFloat(formattedAmount));
    }
  };
  
  // Set a preset percentage of the available balance
  const setPercentage = (percentage: number) => () => {
    setSliderValue(percentage);
    
    if (accountBalance && accountBalance !== "0") {
      const maxAmount = parseFloat(accountBalance);
      const calculatedAmount = (maxAmount * (percentage / 100));
      const formattedAmount = calculatedAmount.toFixed(6).replace(/\.?0+$/, "");
      setValue("amount", parseFloat(formattedAmount));
    }
  };

  useEffect(() => {
    StorageUtil.setTransactionValues(blockchain, {
      receiverAddress: formValues.receiverAddress,
      amount: formValues.amount,
    });
  }, [formValues.receiverAddress, formValues.amount]);

  // --- PLACE renderPinInput FUNCTION HERE ---
  const renderPinInput = () => {
    // Only render the PIN input if NOT using the extension
    if (!isUsingExtension) {
      return (
        <FormField
          control={control}
          name="mnemonicPhrases"
          render={({ field }) => (
            <FormItem className="space-y-2">
              <Label htmlFor="pin-input">Enter 4 to 6-Digit PIN</Label>
              <FormControl>
                {/* Ensure PinInput handles onChange correctly */}
                <PinInput length={6} onChange={(value) => field.onChange(value)} value={field.value || ''} autoFocus={false} />
              </FormControl>
              <FormDescription>
                Enter the PIN used to encrypt your wallet seed during import.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      );
    }
    return null; // Don't render PIN input if using extension
  };

  // ---- Conditional Rendering based on transactionStatus ----

  // Confirmed State
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

  // Pending State
  if (transactionStatus.state === 'pending') {
    return (
        <div className="flex w-full flex-col items-center justify-center gap-4 py-16 text-center">
          <Loader className="h-12 w-12 animate-spin text-primary" />
          <h2 className="text-2xl font-semibold">Transaction Pending</h2>
          <p className="text-muted-foreground">
            Your transaction has been submitted and is awaiting confirmation.
          </p>
          {transactionStatus.txHash && (
            <a
              href={getExplorerTxUrl(transactionStatus.txHash, blockchain)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-2 text-sm text-secondary hover:text-secondary/80"
            >
              View on ZondScan <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {transactionStatus.pendingDetails ? (
            <div className="mt-4 w-full max-w-md rounded border bg-muted p-4 text-left text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Hash:</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono" title={transactionStatus.txHash || 'N/A'}>
                    {transactionStatus.txHash 
                      ? `${transactionStatus.txHash.substring(0, 10)}...${transactionStatus.txHash.substring(transactionStatus.txHash.length - 8)}` 
                      : 'N/A'}
                  </span>
                  {transactionStatus.txHash && (
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={() => copyToClipboard(transactionStatus.txHash!)}
                      title="Copy Hash"
                    >
                      {hasJustCopied ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">From:</span>
                <span className="font-mono" title={transactionStatus.pendingDetails.from}>{transactionStatus.pendingDetails.from}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">To:</span>
                <span className="font-mono" title={transactionStatus.pendingDetails.to}>{transactionStatus.pendingDetails.to}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Value:</span>
                <span>{utils.fromWei(BigInt(transactionStatus.pendingDetails.value), "ether")} QRL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Gas Price:</span>
                <span>{utils.fromWei(BigInt(transactionStatus.pendingDetails.gasPrice), "gwei")} Gwei</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Seen:</span>
                <span>{new Date(transactionStatus.pendingDetails.lastSeen * 1000).toLocaleString()}</span>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Fetching details...</p>
          )}
        </div>
    );
  }

  // Failed State
  if (transactionStatus.state === 'failed') {
    return (
        <div className="flex w-full flex-col items-center justify-center gap-4 py-16 text-center">
          <X className="h-12 w-12 text-destructive" /> {/* Using X for failure indication */}
          <h2 className="text-2xl font-semibold text-destructive">Transaction Failed</h2>
          <p className="text-destructive">
            {transactionStatus.error || "An unknown error occurred."}
          </p>
          {transactionStatus.txHash && (
            <a
              href={getExplorerTxUrl(transactionStatus.txHash, blockchain)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-2 text-sm text-secondary hover:text-secondary/80"
            >
              View on ZondScan <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <Button
            variant="outline"
            onClick={resetTransactionStatus} // Go back to the form
            className="mt-4"
          >
            Dismiss
          </Button>
        </div>
    );
  }

  // Idle State (Default) - Show the form
  return (
    <>
      <SEO title="Send Transaction" />
      <div className="flex w-full items-start justify-center py-8 overflow-x-hidden">
        <div className="relative w-full max-w-2xl px-4">
          { <video
            autoPlay
            muted
            loop
            playsInline
            className={"fixed left-0 top-0 z-0 h-96 w-96 -translate-x-8 scale-150 overflow-hidden"}
          >
            <source src="/tree.mp4" type="video/mp4" />
          </video> }
          <div className="relative z-10">
            <Form {...form}>
              <form className="w-full" onSubmit={handleSubmit(onSubmit)} autoComplete="on">
                <Card className="w-full">
                  <CardHeader>
                    <CardTitle>Send Quanta</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-8">
                    <div className="flex flex-col gap-2">
                      <Label>From</Label>
                      <div className="font-bold text-secondary">
                        {`${prefix} ${addressSplit.join(" ")}`}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Available balance: {formatBalance(accountBalance)} QRL
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
                    <FormField
                      control={control}
                      name="receiverAddress"
                      render={({ field }) => (
                        <FormItem>
                          <Label>To</Label>
                          <FormControl>
                            <Input
                              {...field}
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
                    <FormField
                      control={control}
                      name="amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <Label
                                  htmlFor="amount"
                                  className="text-sm font-medium"
                                >
                                  Amount
                                </Label>
                                <span className="text-sm text-muted-foreground">
                                  {formatBalance(accountBalance)} QRL available
                                </span>
                              </div>
                              <Input
                                id="amount"
                                placeholder="Enter amount"
                                {...field}
                                type="number"
                                step="0.001"
                                onChange={(e) => {
                                  field.onChange(
                                    e.target.value === ""
                                      ? 0
                                      : parseFloat(e.target.value)
                                  );
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
                            />
                            
                            <div className="flex justify-between gap-2">
                              <Button 
                                type="button" 
                                variant="outline" 
                                size="sm" 
                                onClick={setPercentage(25)}
                                className="flex-1"
                              >
                                25%
                              </Button>
                              <Button 
                                type="button" 
                                variant="outline" 
                                size="sm" 
                                onClick={setPercentage(50)}
                                className="flex-1"
                              >
                                50%
                              </Button>
                              <Button 
                                type="button" 
                                variant="outline" 
                                size="sm" 
                                onClick={setPercentage(75)}
                                className="flex-1"
                              >
                                75%
                              </Button>
                              <Button 
                                type="button" 
                                variant="outline" 
                                size="sm" 
                                onClick={setPercentage(100)}
                                className="flex-1"
                              >
                                Max
                              </Button>
                            </div>
                          </div>
                          
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {renderPinInput()}
                    <GasFeeNotice
                      from={accountAddress}
                      to={formValues.receiverAddress}
                      value={formValues.amount}
                      isSubmitting={isSubmitting}
                    />
                  </CardContent>
                  <CardFooter className="grid grid-cols-2 gap-4">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={cancelTransaction}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Cancel
                    </Button>
                    <Button disabled={isSubmitting || !isValid} type="submit">
                      {isSubmitting ? (
                        <Loader className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      Send
                    </Button>
                  </CardFooter>
                </Card>
              </form>
            </Form>
          </div>
        </div>
      </div>
    </>
  );
});

export default AccountDetails;
