import { Button } from "../../../UI/Button";
import {
  Card,
  CardContent,
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
  FormMessage,
} from "@/components/UI/Form";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import { Separator } from "@/components/UI/Separator";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { zodResolver } from "@hookform/resolvers/zod";
import { TransactionReceipt } from "@theqrl/web3";
import { Loader, Send, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { GasFeeNotice } from "./GasFeeNotice/GasFeeNotice";
import { TransactionSuccessful } from "./TransactionSuccessful/TransactionSuccessful";
import { getExplorerAddressUrl } from "@/configuration/zondConfig";
import { Copy, ExternalLink } from "lucide-react";
import { formatBalance } from "@/utilities/helper";
import { Slider } from "@/components/UI/Slider";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import { WalletEncryptionUtil } from "@/utilities/walletEncryptionUtil";

const FormSchema = z
  .object({
    receiverAddress: z.string().min(1, "Receiver address is required"),
    amount: z.coerce.number().gt(0, "Amount should be more than 0"),
    mnemonicPhrases: z.string().min(1, "Mnemonic phrases are required"),
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
    zondConnection,
    fetchAccounts,
  } = zondStore;
  const { blockchain } = zondConnection;
  const { accountAddress } = activeAccount;

  const [transactionReceipt, setTransactionReceipt] =
    useState<TransactionReceipt>();
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

  const onCopy = () => {
    setHasJustCopied(true);
    navigator.clipboard.writeText(accountAddress);
    const newTimer = setTimeout(() => {
      setHasJustCopied(false);
    }, 1000);
    setTimer(newTimer);
  };

  const onViewInExplorer = () => {
    if (accountAddress) {
      window.open(getExplorerAddressUrl(accountAddress, blockchain), '_blank');
    }
  };

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    try {
      // Get the encrypted seed from storage
      const encryptedSeed = await StorageUtil.getEncryptedSeed(blockchain, accountAddress);
      
      if (!encryptedSeed) {
        // If no encrypted seed is found, show a message to set up a PIN
        control.setError("mnemonicPhrases", {
          message: "No stored seed found for this account. Please import your account again to set up a PIN.",
        });
        return;
      }
      
      let mnemonicPhrases;
      
      try {
        // Decrypt the seed using the PIN
        const decryptedSeed = WalletEncryptionUtil.decryptSeedWithPin(encryptedSeed, formData.mnemonicPhrases);
        mnemonicPhrases = decryptedSeed.mnemonic;
      } catch (error) {
        control.setError("mnemonicPhrases", {
          message: "Invalid PIN. Please try again.",
        });
        return;
      }

      const { transactionReceipt: newTransactionReceipt, error } = await signAndSendTransaction(
        accountAddress,
        formData.receiverAddress,
        formData.amount,
        mnemonicPhrases
      );

      if (error) {
        control.setError("mnemonicPhrases", {
          message: `An error occurred. ${error}`,
        });
      } else {
        const isTransactionSuccessful =
          newTransactionReceipt?.status.toString() === "1";
        if (isTransactionSuccessful) {
          StorageUtil.clearTransactionValues(blockchain);
          resetForm();
          setTransactionReceipt(newTransactionReceipt);
          await fetchAccounts();
          await zondStore.refreshTokenBalances();
          window.scrollTo(0, 0);
        } else {
          control.setError("mnemonicPhrases", {
            message: `Transaction failed.`,
          });
        }
      }
    } catch (error) {
      control.setError("mnemonicPhrases", {
        message: `An error occurred. ${error}`,
      });
    }
  }

  const resetForm = () => {
    reset({ receiverAddress: "", amount: 0, mnemonicPhrases: "" });
    setSliderValue(0);
  };

  const cancelTransaction = () => {
    resetForm();
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

  if (transactionReceipt) {
    return <TransactionSuccessful 
      transactionReceipt={transactionReceipt}
    />;
  }

  return (
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
                        onClick={onCopy}
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
                  <FormField
                    control={control}
                    name="mnemonicPhrases"
                    render={({ field }) => (
                      <FormItem>
                        <Label>Transaction PIN</Label>
                        <FormControl>
                          <PinInput
                            length={6}
                            placeholder="Enter your PIN"
                            value={field.value}
                            onChange={field.onChange}
                            disabled={isSubmitting}
                            description="Enter your PIN to authorize this transaction"
                            error={form.formState.errors.mnemonicPhrases?.message}
                            autoFocus
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
  );
});

export default AccountDetails;
