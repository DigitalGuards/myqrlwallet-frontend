import { Button } from "@/components/UI/Button";
import { ShinyButton } from "@/components/UI/ShinyButton";
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
import { NATIVE_TOKEN } from "@/constants";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import { StorageUtil } from "@/utils/storage";
import { zodResolver } from "@hookform/resolvers/zod";
import { utils } from "@theqrl/web3";
import {
  Loader,
  Send,
  X,
  Copy,
  Coins,
  ExternalLink,
  ScanLine,
  Check,
  BookUser,
} from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";
import { GasFeeNotice } from "./GasFeeNotice/GasFeeNotice";
import { AddressBookPicker } from "../AddressBook/AddressBookPicker";
import { TransactionSuccessful } from "./TransactionSuccessful/TransactionSuccessful";
import {
  getExplorerAddressUrl,
  getExplorerTxUrl,
  QRL_PROVIDER,
} from "@/config";
import { Slider } from "@/components/UI/Slider";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import {
  DeviceCredentialUnavailableError,
  decryptStoredSeedWithPin,
  getAddressFromMnemonicAsync,
} from "@/utils/crypto";
import { walletMutations } from "@/utils/nativeWalletMutation";
import { isDesktop } from "@/desktop/bridge";
import {
  copyToClipboard,
  openExternalUrl,
  isInNativeApp,
  requestQRScan,
  subscribeToNativeMessages,
  triggerHaptic,
} from "@/utils/nativeApp";
import type { FeeLevel } from "@/stores/qrlStore";
import type { RecipientSubmission } from "@/hooks/useQrnsRecipient";
import { useNetworkQrnsRecipient } from "@/hooks/useNetworkQrnsRecipient";
import { RecipientResolutionStatus } from "@/components/Core/RecipientResolutionStatus";
import { SEO } from "@/components/SEO/SEO";
import {
  getOptimalTokenBalance,
  formatAddressShort,
} from "@/utils/formatting";
import { QrlAddress } from "@/components/UI/QrlAddress";
import { fetchBalance, isValidQrlAddress } from "@/utils/web3";
import { formatUnits, parseUnits } from "@/utils/web3/units";
import { nativeMaxReserve } from "@/utils/web3/nativeMaxReserve";
import { BigNumber } from "bignumber.js";

const Transfer = observer(() => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { qrlStore, tokenStore } = useStore();
  const {
    activeAccount,
    getAccountBalance,
    signAndSendTransaction,
    sendTransactionViaProvider,
    activeAccountSource,
    qrlConnection,
    transactionStatus,
    resetTransactionStatus,
    estimateNativeTransferFee,
  } = qrlStore;
  const { visibleTokenList, sendToken: sendTokenToStore } = tokenStore;
  const { blockchain } = qrlConnection;
  const { accountAddress } = activeAccount;

  const isUsingExtension = activeAccountSource === "extension";
  const isUsingMobile = activeAccountSource === "mobile";
  // Remote signers (extension popup or paired mobile app) confirm in their
  // own UI, so no local PIN is involved.
  const isUsingRemoteSigner = isUsingExtension || isUsingMobile;

  // Create FormSchema with PIN validation based on the signer type
  const FormSchema = useMemo(
    () =>
      z
        .object({
          asset: z.string().min(1, "Please select an asset"),
          receiverAddress: z.string().min(1, "Receiver address is required"),
          amount: z.string().regex(/^\d*\.?\d+$/, "Enter a decimal amount")
            .refine((value) => new BigNumber(value).gt(0), "Amount should be more than 0"),
          pin: z.string().optional(),
        })
        .superRefine((fields, ctx) => {
          const decimals = fields.asset === "native"
            ? 18
            : visibleTokenList.find((token) => token.address === fields.asset)?.decimals ?? 18;
          try {
            parseUnits(fields.amount, decimals);
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Enter an amount with at most ${decimals} decimal places`,
              path: ["amount"],
            });
          }
          // Validate PIN for seed accounts only. Remote signers confirm on their
          // side, and on desktop there is no PIN: the signer session is already
          // unlocked, so the PIN field is hidden and not required.
          if (!isUsingRemoteSigner && !isDesktop) {
            if (!fields.pin || fields.pin.length < 4 || fields.pin.length > 6) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "PIN must be between 4 to 6 digits",
                path: ["pin"],
              });
            }
          }
        }),
    [isUsingRemoteSigner, visibleTokenList],
  );

  // Get initial asset from URL params (for token transfers from home page)
  const initialAsset = searchParams.get("asset") || "native";

  // Prefill from the address book page's Send action (navigation state).
  const location = useLocation();
  const prefilledReceiver =
    typeof (location.state as { receiverAddress?: unknown } | null)
      ?.receiverAddress === "string"
      ? (location.state as { receiverAddress: string }).receiverAddress
      : "";

  const [sliderValue, setSliderValue] = useState(0);
  const [feeLevel, setFeeLevel] = useState<FeeLevel>("medium");
  const [amountInputValue, setAmountInputValue] = useState("");
  const [tokenBalance, setTokenBalance] = useState("0");
  const [hasJustCopied, setHasJustCopied] = useState(false);
  const [nativeFeeQuote, setNativeFeeQuote] = useState<{
    key: string;
    provider: typeof qrlStore.qrlInstance;
    reserve: string;
  } | null>(null);
  const [percentageQuote, setPercentageQuote] = useState<{
    key: string;
    provider: typeof qrlStore.qrlInstance;
  } | null>(null);

  // QR Scanner state
  const [isScanning, setIsScanning] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [scannedAddressPreview, setScannedAddressPreview] = useState<
    string | null
  >(null);

  // Address book picker state
  const [addressBookOpen, setAddressBookOpen] = useState(false);

  // Preserved across resetForm so the success screen can show the amount sent.
  const [submittedAmount, setSubmittedAmount] = useState<string>("");
  const [submittedAssetSymbol, setSubmittedAssetSymbol] = useState<string>("");

  const form = useForm({
    resolver: zodResolver(FormSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      asset: initialAsset,
      receiverAddress: prefilledReceiver,
      amount: "",
      pin: "",
    },
  });

  const {
    reset,
    handleSubmit,
    control,
    watch,
    setValue,
    clearErrors,
    formState: { isSubmitting, isValid },
  } = form;

  const selectedAsset = watch("asset");
  const formValues = watch() as z.infer<typeof FormSchema>;
  const isNativeTransfer = selectedAsset === "native";
  const recipientResolution = useNetworkQrnsRecipient({
    input: formValues.receiverAddress ?? "",
    blockchain,
    accountAddress,
  });

  // Get selected token info
  const selectedToken = !isNativeTransfer
    ? visibleTokenList.find((t) => t.address === selectedAsset)
    : null;

  // Get balance based on selected asset
  const accountBalance = isNativeTransfer
    ? getAccountBalance(accountAddress)
    : tokenBalance;

  // Fetch token balance when asset changes
  useEffect(() => {
    let cancelled = false;
    setTokenBalance("0");
    const fetchTokenBalance = async () => {
      if (!isNativeTransfer && selectedAsset && accountAddress) {
        try {
          const selectedBlockChain = await StorageUtil.getBlockChain();
          const balance = await fetchBalance(
            selectedAsset,
            accountAddress,
            QRL_PROVIDER[selectedBlockChain as keyof typeof QRL_PROVIDER].url,
          );
          const token = visibleTokenList.find(
            (t) => t.address === selectedAsset,
          );
          if (!cancelled) setTokenBalance(formatUnits(balance, token?.decimals ?? 18));
        } catch (error) {
          console.error("Error fetching token balance:", error);
          if (!cancelled) setTokenBalance("0");
        }
      }
    };
    fetchTokenBalance();
    return () => { cancelled = true; };
  }, [selectedAsset, accountAddress, blockchain, isNativeTransfer, visibleTokenList]);

  // Reset amount when asset changes
  useEffect(() => {
    setAmountInputValue("");
    setSliderValue(0);
    setValue("amount", "");
  }, [selectedAsset, setValue]);

  const feeQuoteKey = JSON.stringify([
    blockchain, accountAddress, activeAccountSource, feeLevel, accountBalance,
    recipientResolution.bindingKey, recipientResolution.address,
  ]);
  const feeQuoteProvider = qrlStore.qrlInstance;
  const feeQuoteRecipient = recipientResolution.status === "success"
    ? recipientResolution.address : null;
  const nativeGasReserve = nativeFeeQuote?.key === feeQuoteKey
    && nativeFeeQuote.provider === feeQuoteProvider ? nativeFeeQuote.reserve : null;
  const percentageReady = !isNativeTransfer || nativeGasReserve !== null;
  const stalePercentageAmount = percentageQuote !== null && (
    !isNativeTransfer || percentageQuote.key !== feeQuoteKey
    || percentageQuote.provider !== feeQuoteProvider
  );

  useEffect(() => {
    if (!stalePercentageAmount) return;
    setPercentageQuote(null);
    setAmountInputValue("");
    setSliderValue(0);
    setValue("amount", "", { shouldValidate: true });
  }, [stalePercentageAmount, setValue]);

  // Bind Max to a current recipient quote. The paired phone owns its fee policy.
  useEffect(() => {
    setNativeFeeQuote(null);
    if (!isNativeTransfer || isUsingMobile || !feeQuoteRecipient || !accountAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const reserve = await nativeMaxReserve(accountBalance, (value) => {
          if (cancelled) throw new Error("Fee quote superseded");
          return estimateNativeTransferFee(feeLevel, {
            from: accountAddress, to: feeQuoteRecipient, value,
          });
        });
        if (!cancelled) setNativeFeeQuote({ key: feeQuoteKey, provider: feeQuoteProvider, reserve });
      } catch {
        // Manual amounts remain available; a missing quote cannot enable Max.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isNativeTransfer,
    isUsingMobile,
    feeLevel,
    estimateNativeTransferFee,
    accountAddress,
    accountBalance,
    feeQuoteKey,
    feeQuoteProvider,
    feeQuoteRecipient,
  ]);

  // Balance available for the transfer amount itself (subtracting gas reserve for native).
  const maxSendableBalance = useMemo(() => {
    if (!isNativeTransfer) return accountBalance;
    if (nativeGasReserve === null) return "0";
    const balanceBn = new BigNumber(accountBalance || "0");
    const reserveBn = new BigNumber(nativeGasReserve || "0");
    const sendable = balanceBn.minus(reserveBn);
    return sendable.isPositive() ? sendable.toString() : "0";
  }, [accountBalance, nativeGasReserve, isNativeTransfer]);

  // Handle QR scan request
  const handleScanQR = useCallback(() => {
    if (!isInNativeApp()) return;
    setIsScanning(true);
    setScannedAddressPreview(null);
    setScanSuccess(false);
    requestQRScan();
  }, []);

  // Subscribe to QR scan results
  useEffect(() => {
    if (!isInNativeApp()) return;

    const unsubscribe = subscribeToNativeMessages((message) => {
      if (message.type === "QR_RESULT" && message.payload) {
        const scannedAddress = (message.payload["address"] as string) || "";
        setIsScanning(false);

        // Validate the scanned address
        if (isValidQrlAddress(scannedAddress)) {
          // Success - trigger haptic, show success animation, set value
          triggerHaptic("success");
          setScanSuccess(true);
          setScannedAddressPreview(formatAddressShort(scannedAddress));
          setValue("receiverAddress", scannedAddress, { shouldValidate: true });

          // Clear success state after animation
          setTimeout(() => {
            setScanSuccess(false);
            setScannedAddressPreview(null);
          }, 2000);
        } else {
          // Invalid address - show error haptic
          triggerHaptic("error");
          control.setError("receiverAddress", {
            message: "Scanned QR does not contain a valid QRL address",
          });
        }
      } else if (message.type === "QR_CANCELLED") {
        // User closed scanner without scanning - just reset the scanning state
        setIsScanning(false);
      } else if (message.type === "ERROR") {
        setIsScanning(false);
        triggerHaptic("error");
      }
    });

    return unsubscribe;
  }, [setValue, control]);

  if (!accountAddress) {
    return (
      <>
        <SEO title="Transfer" />
        <div className="flex w-full items-start justify-center py-2 md:py-8 overflow-x-hidden">
          <div className="page-enter relative w-full max-w-2xl px-2 md:px-4">
            <img
              className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
              src="/tree.svg"
              alt="Background Tree"
            />
            <Card className="w-full">
              <CardHeader>
                <CardTitle className="text-2xl font-bold">Transfer</CardTitle>
                <CardDescription>
                  Send Quanta or tokens to another wallet
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

  const handleCopy = async (text: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setHasJustCopied(true);
      setTimeout(() => setHasJustCopied(false), 1000);
    }
  };

  const onViewInExplorer = () => {
    if (accountAddress) {
      openExternalUrl(getExplorerAddressUrl(accountAddress, blockchain));
    }
  };

  function revalidateRecipient(
    submission: RecipientSubmission,
  ): string | null {
    const recipientAddress =
      recipientResolution.revalidateSubmission(submission);
    if (!recipientAddress) {
      control.setError("receiverAddress", {
        message:
          "Recipient resolution changed. Verify the recipient again before signing.",
      });
    }
    return recipientAddress;
  }

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    if (stalePercentageAmount) return;
    const recipientSubmission = recipientResolution.captureSubmission(
      formData.receiverAddress,
    );
    if (!recipientSubmission) {
      control.setError("receiverAddress", {
        message:
          recipientResolution.message ??
          "Enter a valid QIP-55 address or a resolved QNS name.",
      });
      return;
    }

    setSubmittedAmount(formData.amount.toString());
    setSubmittedAssetSymbol(
      isNativeTransfer ? NATIVE_TOKEN.symbol : selectedToken?.symbol || "",
    );
    if (isNativeTransfer) {
      await handleNativeTransfer(formData, recipientSubmission);
    } else {
      // Token transfers work through the mobile-app pairing (the relay
      // carries contract calls) but not through extension wallets yet.
      if (isUsingExtension) {
        control.setError("asset", {
          message:
            "Token transfers are not yet supported with extension wallets.",
        });
        return;
      }
      await handleTokenTransfer(formData, recipientSubmission);
    }
  }

  async function handleNativeTransfer(
    formData: z.infer<typeof FormSchema>,
    recipientSubmission: RecipientSubmission,
  ) {
    const valueEther = formData.amount.toString();

    if (isDesktop) {
      // Desktop: no PIN, no seed in the renderer. The store routes through the
      // signer (build + confirm + sign + broadcast); the mnemonic arg is unused.
      try {
        const recipientAddress = revalidateRecipient(recipientSubmission);
        if (!recipientAddress) return;
        await signAndSendTransaction(
          accountAddress,
          recipientAddress,
          valueEther,
          "",
          feeLevel,
        );
        resetForm();
        window.scrollTo(0, 0);
      } catch (error) {
        control.setError("receiverAddress", {
          message: `Transaction failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } else if (isUsingRemoteSigner) {
      const recipientAddress = revalidateRecipient(recipientSubmission);
      if (!recipientAddress) return;
      await sendTransactionViaProvider(
        recipientAddress,
        valueEther,
        feeLevel,
      );
      resetForm();
      window.scrollTo(0, 0);
    } else {
      try {
        const signingGeneration = walletMutations.captureGeneration();
        const encryptedSeed = await StorageUtil.getEncryptedSeed(
          blockchain,
          accountAddress,
        );
        if (!encryptedSeed) {
          control.setError("pin", {
            message: "No stored seed found. Please import your account again.",
          });
          return;
        }

        let mnemonicPhrases;
        try {
          const decryptedSeed = await decryptStoredSeedWithPin(
            blockchain,
            accountAddress,
            encryptedSeed,
            formData.pin || "",
            signingGeneration,
          );
          mnemonicPhrases = decryptedSeed.mnemonic;
        } catch (error) {
          control.setError("pin", {
            message:
              error instanceof DeviceCredentialUnavailableError
                ? "This wallet's device security credential is unavailable. Restore it on the original device or re-import the seed."
                : "Invalid PIN. Please try again.",
          });
          return;
        }

        // Verify decrypted mnemonic matches the expected account address.
        // MLDSA87 derivation runs in the crypto worker, keeping the
        // Transfer modal animating smoothly during the 50–300 ms check.
        const qrlInstance = qrlStore.qrlInstance;
        if (!qrlInstance) {
          control.setError("pin", {
            message: "Wallet not connected. Please try again.",
          });
          return;
        }
        const senderAddress = await getAddressFromMnemonicAsync(
          mnemonicPhrases,
          qrlInstance,
        );
        if (senderAddress !== accountAddress) {
          control.setError("pin", {
            message:
              "Security error: seed mismatch detected. Please re-import this account.",
          });
          return;
        }

        if (!walletMutations.isCurrent(signingGeneration)) {
          throw new Error("Wallet changed while preparing the transaction");
        }

        const recipientAddress = revalidateRecipient(recipientSubmission);
        if (!recipientAddress) return;
        await signAndSendTransaction(
          accountAddress,
          recipientAddress,
          valueEther,
          mnemonicPhrases,
          feeLevel,
        );
        resetForm();
        window.scrollTo(0, 0);
      } catch (error) {
        control.setError("pin", {
          message: `Transaction failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  async function handleTokenTransfer(
    formData: z.infer<typeof FormSchema>,
    recipientSubmission: RecipientSubmission,
  ) {
    if (!selectedToken) return;

    if (isUsingMobile) {
      // Mobile pairing: no PIN, no seed. The store builds the transfer
      // calldata and the phone signs after its own confirmation screen.
      // sendToken reports failure via its return value (the failed
      // transactionStatus screen takes over), so only reset the form on
      // success: Try Again then returns to the still-filled form.
      const rawAmount = parseUnits(
        formData.amount.toString(),
        selectedToken.decimals,
      ).toString();
      const recipientAddress = revalidateRecipient(recipientSubmission);
      if (!recipientAddress) return;
      const sent = await sendTokenToStore(
        selectedToken,
        rawAmount,
        "",
        recipientAddress,
      );
      if (sent) {
        resetForm();
        window.scrollTo(0, 0);
      }
      return;
    }

    if (isDesktop) {
      // Desktop: no PIN, no seed in the renderer. The store builds the transfer
      // calldata and routes through the signer; the mnemonic arg is unused.
      try {
        const recipientAddress = revalidateRecipient(recipientSubmission);
        if (!recipientAddress) return;
        const rawAmount = parseUnits(
          formData.amount.toString(),
          selectedToken.decimals,
        ).toString();
        await sendTokenToStore(
          selectedToken,
          rawAmount,
          "",
          recipientAddress,
        );
        resetForm();
        window.scrollTo(0, 0);
      } catch (error) {
        control.setError("receiverAddress", {
          message: `Transfer failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return;
    }

    try {
      const signingGeneration = walletMutations.captureGeneration();
      const encryptedSeed = await StorageUtil.getEncryptedSeed(
        blockchain,
        accountAddress,
      );
      if (!encryptedSeed) {
        control.setError("pin", {
          message: "No stored seed found. Please import your account again.",
        });
        return;
      }

      let mnemonic;
      try {
        const decryptedSeed = await decryptStoredSeedWithPin(
          blockchain,
          accountAddress,
          encryptedSeed,
          formData.pin || "",
          signingGeneration,
        );
        mnemonic = decryptedSeed.mnemonic;
      } catch (error) {
        control.setError("pin", {
          message:
            error instanceof DeviceCredentialUnavailableError
              ? "This wallet's device security credential is unavailable. Restore it on the original device or re-import the seed."
              : "Invalid PIN. Please try again.",
        });
        return;
      }

      const qrlInstance = qrlStore.qrlInstance;
      if (!qrlInstance) {
        control.setError("pin", {
          message: "Wallet not connected. Please try again.",
        });
        return;
      }
      const senderAddress = await getAddressFromMnemonicAsync(
        mnemonic,
        qrlInstance,
      );
      if (senderAddress !== accountAddress) {
        control.setError("pin", { message: "PIN decrypted an invalid seed." });
        return;
      }

      if (!walletMutations.isCurrent(signingGeneration)) {
        throw new Error("Wallet changed while preparing the transaction");
      }

      const rawAmount = parseUnits(
        formData.amount.toString(),
        selectedToken.decimals,
      ).toString();
      const recipientAddress = revalidateRecipient(recipientSubmission);
      if (!recipientAddress) return;
      await sendTokenToStore(
        selectedToken,
        rawAmount,
        mnemonic,
        recipientAddress,
      );
      resetForm();
      window.scrollTo(0, 0);
    } catch (error) {
      control.setError("pin", {
        message: `Transfer failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const resetForm = () => {
    reset({ asset: selectedAsset, receiverAddress: "", amount: "", pin: "" });
    setSliderValue(0);
    setAmountInputValue("");
  };

  const cancelTransaction = () => {
    resetForm();
    resetTransactionStatus();
    navigate(ROUTES.HOME);
  };

  const applyPercentage = (percentage: number) => {
    if (!percentageReady) return;
    setPercentageQuote(isNativeTransfer ? { key: feeQuoteKey, provider: feeQuoteProvider } : null);
    setSliderValue(percentage);
    const sendableBn = new BigNumber(maxSendableBalance || "0");
    if (sendableBn.isZero()) {
      setAmountInputValue("");
      setValue("amount", "");
      return;
    }
    const decimals = isNativeTransfer ? 18 : selectedToken?.decimals ?? 18;
    const formattedAmount = sendableBn
      .multipliedBy(percentage)
      .shiftedBy(-2)
      .decimalPlaces(percentage === 100 ? decimals : Math.min(6, decimals), BigNumber.ROUND_DOWN)
      .toFixed();
    setAmountInputValue(formattedAmount);
    setValue("amount", formattedAmount, { shouldValidate: true });
  };

  const handleSliderChange = (value: number[]) => {
    applyPercentage(value[0] ?? 0);
  };

  const setPercentage = (percentage: number) => () => {
    applyPercentage(percentage);
  };

  const assetSymbol = isNativeTransfer
    ? NATIVE_TOKEN.symbol
    : selectedToken?.symbol || "";

  // Transaction States
  if (transactionStatus.state === "confirmed" && transactionStatus.receipt) {
    return (
      <TransactionSuccessful
        transactionReceipt={transactionStatus.receipt}
        amount={submittedAmount}
        assetSymbol={submittedAssetSymbol}
        onDone={() => {
          resetTransactionStatus();
          navigate(ROUTES.HOME);
        }}
      />
    );
  }

  if (transactionStatus.state === "pending") {
    return (
      <div className="flex w-full items-start justify-center py-2 md:py-8 overflow-x-hidden">
        <div className="page-enter relative w-full max-w-2xl px-2 md:px-4">
          <Card className="w-full border-l-4 border-l-primary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Loader className="h-5 w-5 animate-spin" />
                Transaction Pending
              </CardTitle>
            </CardHeader>
            <CardContent className="py-8">
              <div className="flex flex-col items-center gap-4 text-center">
                <p className="text-muted-foreground">
                  Your transaction has been submitted and is awaiting
                  confirmation.
                </p>
                {transactionStatus.txHash && (
                  <a
                    href={getExplorerTxUrl(
                      transactionStatus.txHash,
                      blockchain,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-secondary hover:text-secondary/80"
                  >
                    View on Explorer <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                {transactionStatus.pendingDetails && (
                  <div className="mt-4 w-full max-w-md rounded border bg-muted p-4 text-left text-sm space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">From:</span>
                      <QrlAddress
                        address={transactionStatus.pendingDetails.from}
                        mode="full"
                        className="max-w-[75%] justify-end text-right"
                        addressClassName="text-xs"
                      />
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">To:</span>
                      <QrlAddress
                        address={transactionStatus.pendingDetails.to}
                        mode="full"
                        className="max-w-[75%] justify-end text-right"
                        addressClassName="text-xs"
                      />
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Value:</span>
                      <span>
                        {isNativeTransfer
                          ? `${utils.fromPlanck(BigInt(transactionStatus.pendingDetails.value), "quanta")} ${NATIVE_TOKEN.symbol}`
                          : `${getOptimalTokenBalance(formValues.amount.toString())} ${assetSymbol}`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Gas Price:</span>
                      <span>
                        {utils.fromPlanck(
                          BigInt(transactionStatus.pendingDetails.gasPrice),
                          "shor",
                        )}{" "}
                        Shor
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Gas Limit:</span>
                      <span>
                        {parseInt(
                          transactionStatus.pendingDetails.gas,
                          16,
                        ).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Nonce:</span>
                      <span>
                        {parseInt(transactionStatus.pendingDetails.nonce, 16)}
                      </span>
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

  if (transactionStatus.state === "timeout") {
    return (
      <div className="flex w-full items-start justify-center py-2 md:py-8 overflow-x-hidden">
        <div className="page-enter relative w-full max-w-2xl px-2 md:px-4">
          <Card className="w-full border-l-4 border-l-primary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Loader className="h-5 w-5" />
                Still Pending
              </CardTitle>
            </CardHeader>
            <CardContent className="py-8">
              <div className="flex flex-col items-center gap-4 text-center">
                <p className="text-muted-foreground">
                  {transactionStatus.error ||
                    "The transaction is taking longer than expected. It may still be mined; check the explorer."}
                </p>
                {transactionStatus.txHash && (
                  <a
                    href={getExplorerTxUrl(
                      transactionStatus.txHash,
                      blockchain,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-secondary hover:text-secondary/80"
                  >
                    View on Explorer <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                onClick={resetTransactionStatus}
                className="w-full"
              >
                Done
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  if (transactionStatus.state === "failed") {
    return (
      <div className="flex w-full items-start justify-center py-2 md:py-8 overflow-x-hidden">
        <div className="page-enter relative w-full max-w-2xl px-2 md:px-4">
          <Card className="w-full border-l-4 border-l-destructive">
            <CardHeader className="bg-gradient-to-r from-destructive/10 to-transparent">
              <CardTitle className="flex items-center gap-2 text-destructive">
                <X className="h-5 w-5" />
                Transaction Failed
              </CardTitle>
            </CardHeader>
            <CardContent className="py-8">
              <div className="flex flex-col items-center gap-4 text-center">
                <p className="text-destructive">
                  {transactionStatus.error || "An unknown error occurred."}
                </p>
                {transactionStatus.txHash && (
                  <a
                    href={getExplorerTxUrl(
                      transactionStatus.txHash,
                      blockchain,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-secondary hover:text-secondary/80"
                  >
                    View on Explorer <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                onClick={resetTransactionStatus}
                className="w-full"
              >
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
      <div className="flex w-full items-start justify-center py-2 md:py-8 overflow-x-hidden">
        <div className="page-enter relative w-full max-w-2xl px-2 md:px-4">
          <img
            className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
            src="/tree.svg"
            alt="Background Tree"
          />
          <Form {...form}>
            <form className="w-full" onSubmit={handleSubmit(onSubmit)}>
              <Card className="w-full">
                <CardHeader>
                  <CardTitle className="text-2xl font-bold">Transfer</CardTitle>
                  <CardDescription>
                    Send Quanta or tokens to another wallet
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
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select asset to send" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="native">
                              <div className="flex items-center gap-2">
                                <Coins className="h-4 w-4" />
                                <span>Quanta (Native)</span>
                              </div>
                            </SelectItem>
                            {visibleTokenList.map((token) => (
                              <SelectItem
                                key={token.address}
                                value={token.address}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">
                                    {token.symbol}
                                  </span>
                                  <span className="text-muted-foreground">
                                    - {token.name}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {selectedToken && (
                    <div className="flex flex-col gap-2">
                      <Label>Token contract</Label>
                      <QrlAddress
                        address={selectedToken.address}
                        mode="full"
                        copyable
                        copyLabel="Copy token contract address"
                        className="w-full"
                      />
                    </div>
                  )}

                  <Separator />

                  {/* From Address */}
                  <div className="flex flex-col gap-2">
                    <Label>From</Label>
                    <QrlAddress
                      address={accountAddress}
                      mode="full"
                      className="w-full"
                      addressClassName="font-bold text-identity-accent"
                    />
                    <div className="text-sm text-muted-foreground">
                      Available:{" "}
                      {getOptimalTokenBalance(accountBalance, assetSymbol)}
                    </div>
                    <div className="flex gap-4">
                      <Button
                        className="w-full"
                        type="button"
                        variant="outline"
                        onClick={() => handleCopy(accountAddress)}
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
                        View on Explorer
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
                        <Label htmlFor="transfer-recipient">Send to</Label>
                        <FormControl>
                          <div className="relative">
                            <Input
                              {...field}
                              id="transfer-recipient"
                              value={field.value ?? ""}
                              onChange={(event) => {
                                field.onChange(event);
                                clearErrors("receiverAddress");
                              }}
                              disabled={isSubmitting || isScanning}
                              placeholder="QIP-55 address or QNS name"
                              className={isInNativeApp() ? "pr-16" : "pr-10"}
                            />
                            <button
                              type="button"
                              onClick={() => setAddressBookOpen(true)}
                              disabled={isSubmitting || isScanning}
                              className={`absolute ${isInNativeApp() ? "right-9" : "right-2"} top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-accent transition-colors disabled:opacity-50`}
                              title="Address book"
                            >
                              <BookUser className="h-5 w-5 text-muted-foreground hover:text-foreground" />
                            </button>
                            {isInNativeApp() && (
                              <button
                                type="button"
                                onClick={handleScanQR}
                                disabled={isSubmitting || isScanning}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                                title="Scan QR code"
                              >
                                {scanSuccess ? (
                                  <Check className="h-5 w-5 text-success animate-pulse" />
                                ) : isScanning ? (
                                  <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
                                ) : (
                                  <ScanLine className="h-5 w-5 text-muted-foreground hover:text-foreground" />
                                )}
                              </button>
                            )}
                          </div>
                        </FormControl>
                        {isScanning && (
                          <div className="text-sm text-muted-foreground animate-pulse">
                            Scanning for QRL address...
                          </div>
                        )}
                        {scanSuccess && scannedAddressPreview && (
                          <div className="flex items-center gap-2 text-sm text-green-600">
                            <Check className="h-4 w-4" />
                            <span>Scanned: {scannedAddressPreview}</span>
                          </div>
                        )}
                        {!isScanning && !scanSuccess && (
                          <FormDescription>
                            Enter a QIP-55 address or QNS name, or pick a contact
                            {isInNativeApp() ? ", or scan QR" : ""}
                          </FormDescription>
                        )}
                        <RecipientResolutionStatus
                          resolution={recipientResolution}
                        />
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <AddressBookPicker
                    open={addressBookOpen}
                    onOpenChange={setAddressBookOpen}
                    currentAddress={formValues.receiverAddress}
                    onSelect={(address) =>
                      setValue("receiverAddress", address, {
                        shouldValidate: true,
                      })
                    }
                  />

                  {/* Amount */}
                  <FormField
                    control={control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <div className="space-y-2">
                            <Label>Amount</Label>
                            <Input
                              placeholder="Enter amount"
                              type="text"
                              inputMode="decimal"
                              disabled={isSubmitting}
                              value={amountInputValue}
                              onChange={(e) => {
                                const value = e.target.value.replace(",", ".");
                                if (value === "" || /^\d*\.?\d*$/.test(value)) {
                                  setPercentageQuote(null);
                                  setAmountInputValue(value);
                                  const numValue =
                                    value === "" ? 0 : parseFloat(value) || 0;
                                  field.onChange(value);
                                  if (
                                    maxSendableBalance &&
                                    parseFloat(maxSendableBalance) > 0
                                  ) {
                                    const percentage = Math.min(
                                      100,
                                      (numValue /
                                        parseFloat(maxSendableBalance)) *
                                        100,
                                    );
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
                            <span className="text-sm text-muted-foreground">
                              {sliderValue}%
                            </span>
                          </div>

                          <Slider
                            value={[sliderValue]}
                            min={0}
                            max={100}
                            step={1}
                            onValueChange={handleSliderChange}
                            className="w-full"
                            disabled={isSubmitting || !percentageReady}
                          />

                          <div className="flex justify-between gap-2">
                            {[25, 50, 75, 100].map((pct) => (
                              <Button
                                key={pct}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={setPercentage(pct)}
                                disabled={isSubmitting || !percentageReady}
                                className="flex-1"
                              >
                                {pct === 100 ? "Max" : `${pct}%`}
                              </Button>
                            ))}
                          </div>
                          {isNativeTransfer && !percentageReady && (
                            <p className="text-xs text-muted-foreground">
                              {isUsingMobile
                                ? "Enter an amount manually. Your paired phone calculates the fee."
                                : "Max requires a current fee quote for the recipient. You can enter an amount manually."}
                            </p>
                          )}
                        </div>

                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* PIN Input. Hidden for remote signers (they confirm in
                      their own UI) and on desktop: the signer session is
                      already unlocked and signing does not re-prompt. */}
                  {!isUsingRemoteSigner && !isDesktop && (
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
                              value={field.value || ""}
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

                  {/* Gas Fee Notice (only for native transfers). Hidden for
                      mobile-app accounts: the phone estimates its own gas and
                      presents the fee in its confirmation screen. */}
                  {isNativeTransfer && isUsingMobile && (
                    <p className="text-sm text-muted-foreground">
                      The network fee is estimated and confirmed in the mobile
                      app.
                    </p>
                  )}
                  {isNativeTransfer && !isUsingMobile && (
                    <GasFeeNotice
                      from={accountAddress}
                      to={recipientResolution.address ?? ""}
                      value={formValues.amount}
                      isSubmitting={isSubmitting}
                      feeLevel={feeLevel}
                      onFeeLevelChange={setFeeLevel}
                    />
                  )}
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
                  <ShinyButton
                    disabled={!isValid || !recipientResolution.address || stalePercentageAmount}
                    processing={isSubmitting}
                    type="submit"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    {isSubmitting
                      ? `Sending ${assetSymbol}...`
                      : `Send ${assetSymbol}`}
                  </ShinyButton>
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
