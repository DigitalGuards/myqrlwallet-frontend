import { transferError } from "@/i18n/transferError";
import { transferMessage } from "@/i18n/transferMessage";
import { Trans, useTranslation } from "react-i18next";
import { blockchainKey } from "@/utils/storage/storage";
import { renderValue, toNumber, toTemplateString } from "@/utils/guards";
import { reportError } from "@/utils/reportError";
import { unsignedQuantity } from "@/utils/transactionHistory";
import { PinVerificationError, verifyPinWithLimit } from "@/utils/crypto/verifyPinWithLimit";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { Button } from "@/components/UI/Button";
import { ShinyButton } from "@/components/UI/ShinyButton";
import { Card, CardContent, CardFooter } from "@/components/UI/Card";
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
import { SendStatus } from "./SendStatus";
import { isRecord } from "@/utils/guards";
import { TransactionSuccessful } from "./TransactionSuccessful/TransactionSuccessful";
import {
  getExplorerAddressUrl,
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
import { FEE_NOT_SHOWN, type ApprovedFee } from "@/utils/web3/feePolicy";
import type { RecipientSubmission } from "@/hooks/useQrnsRecipient";
import { useNetworkQrnsRecipient } from "@/hooks/useNetworkQrnsRecipient";
import { RecipientResolutionStatus } from "@/components/Core/RecipientResolutionStatus";
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
  const { t } = useTranslation(["transfer", "common", "settings"]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { qrlStore, tokenStore } = useStore();
  const {
    activeAccount,
    activeAccountSource,
    qrlConnection,
    transactionStatus,
  } = qrlStore;
  const { visibleTokenList } = tokenStore;
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
          asset: z.string().min(1, "transfer:selectAssetRequired"),
          receiverAddress: z.string().min(1, "transfer:receiverRequired"),
          amount: z.string().regex(/^\d*\.?\d+$/, "transfer:decimalAmount")
            .refine((value) => new BigNumber(value).gt(0), "transfer:positiveAmount"),
          pin: z.string().optional(),
        })
        .superRefine((fields, ctx) => {
          const decimals = fields.asset === "native"
            ? 18
            : visibleTokenList.find((token) => token.address === fields.asset)?.decimals ?? 18;
          try {
            parseUnits(fields.amount, decimals);
          } catch {
            const digits = toTemplateString(decimals);
            const count = Number(digits);
            ctx.addIssue({
              code: "custom",
              message: transferError({ key: "transfer:decimals", count: Number.isFinite(count) ? count : 0, digits }),
              path: ["amount"],
            });
          }
          // Validate PIN for seed accounts only. Remote signers confirm on their
          // side, and on desktop there is no PIN: the signer session is already
          // unlocked, so the PIN field is hidden and not required.
          if (!isUsingRemoteSigner && !isDesktop) {
            if (!fields.pin || fields.pin.length < 4 || fields.pin.length > 6) {
              ctx.addIssue({
                code: "custom",
                message: "transfer:pinFormat",
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
  const navigationState: unknown = location.state;
  const prefilledReceiver = isRecord(navigationState) && typeof navigationState['receiverAddress'] === 'string'
    ? navigationState['receiverAddress'] : '';

  const [sliderValue, setSliderValue] = useState(0);
  const [feeLevel, setFeeLevel] = useState<FeeLevel>("medium");
  // The quote behind the fee on screen, with the gas limit it was computed
  // with, handed to signing so it can use neither a more expensive price nor
  // more gas than the figure the user saw covered.
  const [approvedFee, setApprovedFee] = useState<ApprovedFee | null>(null);
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
  const [submittedAssetSymbol, setSubmittedAssetSymbol] = useState<unknown>("");

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
  const formValues = watch();
  const isNativeTransfer = selectedAsset === "native";
  const recipientResolution = useNetworkQrnsRecipient({
    input: formValues.receiverAddress,
    blockchain,
    accountAddress,
  });

  // Get selected token info
  const selectedToken = !isNativeTransfer
    ? visibleTokenList.find((t) => t.address === selectedAsset)
    : null;

  // Get balance based on selected asset
  const accountBalance = isNativeTransfer
    ? qrlStore.getAccountBalance(accountAddress)
    : tokenBalance;

  // Fetch token balance when asset changes
  useEffect(() => {
    let cancelled = false;
    setTokenBalance("0");
    const fetchTokenBalance = async () => {
      if (!isNativeTransfer && selectedAsset && accountAddress) {
        try {
          const selectedBlockChain = await StorageUtil.getBlockChain();
          const balance: unknown = await fetchBalance(
            selectedAsset,
            accountAddress,
            QRL_PROVIDER[blockchainKey(selectedBlockChain)].url,
          );
          const token = visibleTokenList.find(
            (t) => t.address === selectedAsset,
          );
          const quantity = unsignedQuantity(balance);
          if (quantity === null) throw new Error("Invalid token balance.");
          if (!cancelled) setTokenBalance(formatUnits(quantity, token?.decimals ?? 18));
        } catch (error) {
          reportError("Error fetching token balance:", error);
          if (!cancelled) setTokenBalance("0");
        }
      }
    };
    void fetchTokenBalance();
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
    const isCancelled = () => cancelled;
    void (async () => {
      try {
        const reserve = await nativeMaxReserve(accountBalance, (value) => {
          if (isCancelled()) throw new Error("Fee quote superseded");
          return qrlStore.estimateNativeTransferFee(feeLevel, {
            from: accountAddress, to: feeQuoteRecipient, value,
          });
        });
        if (!isCancelled()) setNativeFeeQuote({ key: feeQuoteKey, provider: feeQuoteProvider, reserve });
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
    qrlStore,
    accountAddress,
    accountBalance,
    feeQuoteKey,
    feeQuoteProvider,
    feeQuoteRecipient,
  ]);

  // Balance available for the transfer amount itself (subtracting gas reserve for native).
  const maxSendableBalance = useMemo<unknown>(() => {
    if (!isNativeTransfer) return accountBalance;
    if (nativeGasReserve === null) return "0";
    const balanceBn: unknown = Reflect.construct(BigNumber, [accountBalance || "0"]);
    if (!(balanceBn instanceof BigNumber)) throw new TypeError("Invalid BigNumber result");
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
        const scannedValue: unknown = message.payload["address"];
        const scannedAddress = typeof scannedValue === "string" ? scannedValue : "";
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
            message: "transfer:invalidQr",
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
        <PageShell title={t("transfer:title")} subtitle={t("transfer:subtitle")} seoTitle={t("transfer:title")}>
            <Card className="w-full">
              <CardContent className="pt-6">
                <div className="flex flex-col items-center justify-center p-8 text-center">
                  <p className="text-muted-foreground mb-4">
                    {t("transfer:noAccount")}
                  </p>
                  <Button onClick={() => {
                    Promise.resolve(navigate(ROUTES.IMPORT_ACCOUNT)).catch((error: unknown) => {
                      reportError("Failed to open account import:", error);
                    });
                  }}>
                    {t("transfer:importAccount")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </PageShell>
      </>
    );
  }

  const handleCopy = async (text: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setHasJustCopied(true);
      setTimeout(() => { setHasJustCopied(false); }, 1000);
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
          "transfer:recipientChanged",
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
          "transfer:validRecipient",
      });
      return;
    }

    setSubmittedAmount(formData.amount);
    setSubmittedAssetSymbol(
      isNativeTransfer ? NATIVE_TOKEN.symbol : selectedToken?.symbol || "",
    );
    if (isNativeTransfer) {
      await handleNativeTransfer(formData, recipientSubmission);
    } else {
      await handleTokenTransfer(formData, recipientSubmission);
    }
  }

  async function handleNativeTransfer(
    formData: z.infer<typeof FormSchema>,
    recipientSubmission: RecipientSubmission,
  ) {
    const valueEther = formData.amount;

    if (isDesktop) {
      // Desktop: no PIN, no seed in the renderer. The store routes through the
      // signer (build + confirm + sign + broadcast); the mnemonic arg is unused.
      try {
        const recipientAddress = revalidateRecipient(recipientSubmission);
        if (!recipientAddress) return;
        await qrlStore.signAndSendTransaction(
          accountAddress,
          recipientAddress,
          valueEther,
          "",
          feeLevel,
          approvedFee ?? undefined,
        );
        window.scrollTo(0, 0);
      } catch (error) {
        control.setError("receiverAddress", {
          message: transferError({ key: "transfer:transactionFailed", reason: error instanceof Error ? error.message : String(error) }),
        });
      }
    } else if (isUsingRemoteSigner) {
      const recipientAddress = revalidateRecipient(recipientSubmission);
      if (!recipientAddress) return;
      await qrlStore.sendTransactionViaProvider(
        recipientAddress,
        valueEther,
        feeLevel,
      );
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
            message: "transfer:noSeed",
          });
          return;
        }

        let mnemonicPhrases;
        try {
          const decryptedSeed = await verifyPinWithLimit(() =>
            decryptStoredSeedWithPin(
              blockchain,
              accountAddress,
              encryptedSeed,
              formData.pin || "",
              signingGeneration,
            ),
          );
          mnemonicPhrases = decryptedSeed.mnemonic;
        } catch (error) {
          control.setError("pin", {
            message:
              error instanceof PinVerificationError
                ? error.message
                : error instanceof DeviceCredentialUnavailableError
                  ? "transfer:credentialUnavailable"
                  : "transfer:unlockFailed",
          });
          return;
        }

        // Verify decrypted mnemonic matches the expected account address.
        // MLDSA87 derivation runs in the crypto worker, keeping the
        // Transfer modal animating smoothly during the 50–300 ms check.
        const qrlInstance = qrlStore.qrlInstance;
        if (!qrlInstance) {
          control.setError("pin", {
            message: "transfer:notConnected",
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
              "transfer:seedMismatch",
          });
          return;
        }

        if (!walletMutations.isCurrent(signingGeneration)) {
          throw new Error("Wallet changed while preparing the transaction");
        }

        const recipientAddress = revalidateRecipient(recipientSubmission);
        if (!recipientAddress) return;
        await qrlStore.signAndSendTransaction(
          accountAddress,
          recipientAddress,
          valueEther,
          mnemonicPhrases,
          feeLevel,
          approvedFee ?? undefined,
        );
        window.scrollTo(0, 0);
      } catch (error) {
        control.setError("pin", {
          message: transferError({ key: "transfer:transactionFailed", reason: error instanceof Error ? error.message : String(error) }),
        });
      }
    }
  }

  async function handleTokenTransfer(
    formData: z.infer<typeof FormSchema>,
    recipientSubmission: RecipientSubmission,
  ) {
    if (!selectedToken) return;

    if (isUsingRemoteSigner) {
      // The signer confirms the transfer in its own approval screen.
      const rawAmount = parseUnits(
        formData.amount,
        selectedToken.decimals,
      ).toString();
      const recipientAddress = revalidateRecipient(recipientSubmission);
      if (!recipientAddress) return;
      const sent = await tokenStore.sendToken(
        selectedToken,
        rawAmount,
        "",
        recipientAddress,
        // The remote signer displays the network fee for approval.
        "medium",
        FEE_NOT_SHOWN,
      );
      if (sent) {
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
          formData.amount,
          selectedToken.decimals,
        ).toString();
        await tokenStore.sendToken(
          selectedToken,
          rawAmount,
          "",
          recipientAddress,
          // No network fee is displayed for a token send yet.
          "medium",
          FEE_NOT_SHOWN,
        );
        window.scrollTo(0, 0);
      } catch (error) {
        control.setError("receiverAddress", {
          message: transferError({ key: "transfer:transferFailed", reason: error instanceof Error ? error.message : String(error) }),
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
          message: "transfer:noSeed",
        });
        return;
      }

      let mnemonic;
      try {
        const decryptedSeed = await verifyPinWithLimit(() =>
          decryptStoredSeedWithPin(
            blockchain,
            accountAddress,
            encryptedSeed,
            formData.pin || "",
            signingGeneration,
          ),
        );
        mnemonic = decryptedSeed.mnemonic;
      } catch (error) {
        control.setError("pin", {
          message:
            error instanceof PinVerificationError
              ? error.message
              : error instanceof DeviceCredentialUnavailableError
                ? "transfer:credentialUnavailable"
                : "transfer:unlockFailed",
        });
        return;
      }

      const qrlInstance = qrlStore.qrlInstance;
      if (!qrlInstance) {
        control.setError("pin", {
          message: "transfer:notConnected",
        });
        return;
      }
      const senderAddress = await getAddressFromMnemonicAsync(
        mnemonic,
        qrlInstance,
      );
      if (senderAddress !== accountAddress) {
        control.setError("pin", { message: "transfer:invalidSeed" });
        return;
      }

      if (!walletMutations.isCurrent(signingGeneration)) {
        throw new Error("Wallet changed while preparing the transaction");
      }

      const rawAmount = parseUnits(
        formData.amount,
        selectedToken.decimals,
      ).toString();
      const recipientAddress = revalidateRecipient(recipientSubmission);
      if (!recipientAddress) return;
      await tokenStore.sendToken(
        selectedToken,
        rawAmount,
        mnemonic,
        recipientAddress,
        // No network fee is displayed for a token send yet.
        "medium",
        FEE_NOT_SHOWN,
      );
      window.scrollTo(0, 0);
    } catch (error) {
      control.setError("pin", {
        message: transferError({ key: "transfer:transferFailed", reason: error instanceof Error ? error.message : String(error) }),
      });
    }
  }

  const resetForm = () => {
    reset({ asset: selectedAsset, receiverAddress: "", amount: "", pin: "" });
    setSliderValue(0);
    setAmountInputValue("");
  };

  const backToForm = () => {
    qrlStore.resetTransactionStatus();
    // Release form submission state while the signer request may still be open.
    reset(undefined, {
      keepValues: true,
      keepErrors: true,
      keepDirty: true,
      keepTouched: true,
      keepIsValid: true,
    });
  };

  const cancelTransaction = () => {
    resetForm();
    qrlStore.resetTransactionStatus();
    Promise.resolve(navigate(ROUTES.HOME)).catch((error: unknown) => {
      reportError("Failed to open home:", error);
    });
  };

  const applyPercentage = (percentage: number) => {
    if (!percentageReady) return;
    setPercentageQuote(isNativeTransfer ? { key: feeQuoteKey, provider: feeQuoteProvider } : null);
    setSliderValue(percentage);
    const sendableBn: unknown = Reflect.construct(BigNumber, [maxSendableBalance || "0"]);
    if (!(sendableBn instanceof BigNumber)) throw new TypeError("Invalid BigNumber result");
    if (sendableBn.isZero()) {
      setAmountInputValue("");
      setValue("amount", "");
      return;
    }
    const decimals = isNativeTransfer ? 18 : selectedToken?.decimals ?? 18;
    const scaledAmount = sendableBn.multipliedBy(percentage).shiftedBy(-2);
    const roundedAmount: unknown = Reflect.apply(scaledAmount.decimalPlaces.bind(scaledAmount), scaledAmount, [
      percentage === 100 ? decimals : Math.min(6, toNumber(decimals)), BigNumber.ROUND_DOWN,
    ]);
    if (!(roundedAmount instanceof BigNumber)) throw new TypeError("Invalid BigNumber result");
    const formattedAmount = roundedAmount.toFixed();
    setAmountInputValue(formattedAmount);
    setValue("amount", formattedAmount, { shouldValidate: true });
  };

  const handleSliderChange = (value: number[]) => {
    applyPercentage(value[0] ?? 0);
  };

  const setPercentage = (percentage: number) => () => {
    applyPercentage(percentage);
  };

  /**
   * A native send waits for its fee to be on screen.
   *
   * Sending while the estimate is loading or failed is sending a cost the
   * user was never shown, and the signing guard now fails closed on exactly
   * that. The phone shows its own fee, and on desktop the isolated signer
   * does, so neither is gated here.
   */
  const nativeFeePending =
    isNativeTransfer && !isUsingMobile && !isDesktop && approvedFee === null;

  const assetSymbol = isNativeTransfer
    ? NATIVE_TOKEN.symbol
    : selectedToken?.symbol || "";

  // Transaction States
  if (transactionStatus.state === "confirmed" && transactionStatus.receipt) {
    return (
      <TransactionSuccessful
        transactionReceipt={transactionStatus.receipt}
        amount={transactionStatus.details?.amount ?? submittedAmount}
        assetSymbol={transactionStatus.details?.asset ?? submittedAssetSymbol}
        blockchain={transactionStatus.details?.blockchain}
        onDone={() => {
          resetForm();
          qrlStore.resetTransactionStatus();
          Promise.resolve(navigate(ROUTES.HOME)).catch((error: unknown) => {
            reportError("Failed to open home:", error);
          });
        }}
      />
    );
  }

  if (transactionStatus.state !== "idle") {
    return (
      <SendStatus
        status={transactionStatus}
        blockchain={blockchain}
        onBack={transactionStatus.state === "timeout" ? cancelTransaction : backToForm}
      />
    );
  }

  // Main Form
  return (
    <>
      <PageShell title={t("transfer:title")} subtitle={t("transfer:subtitle")} seoTitle={t("transfer:title")}>
          <Form {...form}>
            <form className="w-full" onSubmit={(event) => {
              handleSubmit(onSubmit)(event).catch((error: unknown) => {
                control.setError("receiverAddress", {
                  message: transferError({ key: "transfer:transferFailed", reason: error instanceof Error ? error.message : "transfer:unexpectedError" }),
                });
              });
            }}>
              <Card className="w-full">
                <CardContent className="space-y-6 pt-6">
                  {/* Asset Selector */}
                  <FormField
                    control={control}
                    name="asset"
                    render={({ field }) => (
                      <FormItem>
                        <Label>{t("transfer:asset")}</Label>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t("transfer:selectAsset")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="native">
                              <div className="flex items-center gap-2">
                                <Coins className="h-4 w-4" />
                                <span>{t("transfer:native")}</span>
                              </div>
                            </SelectItem>
                            {visibleTokenList.map((token) => (
                              <SelectItem
                                key={token.address}
                                value={token.address}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">
                                    {renderValue(token.symbol)}
                                  </span>
                                  <span className="text-muted-foreground">
                                    - {renderValue(token.name)}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage translateMessage={(message) => transferMessage(message, t) ?? undefined} />
                      </FormItem>
                    )}
                  />

                  {selectedToken && (
                    <div className="flex flex-col gap-2">
                      <Label>{t("transfer:tokenContract")}</Label>
                      <QrlAddress
                        address={selectedToken.address}
                        mode="full"
                        copyable
                        copyLabel={t("transfer:copyContract")}
                        className="w-full"
                      />
                    </div>
                  )}

                  <Separator />

                  {/* From Address */}
                  <div className="flex flex-col gap-2">
                    <Label>{t("transfer:from")}</Label>
                    <QrlAddress
                      address={accountAddress}
                      mode="full"
                      className="w-full"
                      addressClassName="font-bold text-identity-accent"
                    />
                    <div className="text-sm text-muted-foreground">
                      <Trans t={t} i18nKey="transfer:available" components={{ balance: <span className="font-numeric">{getOptimalTokenBalance(accountBalance, assetSymbol)}</span> }} />
                    </div>
                    <div className="flex gap-4">
                      <Button
                        className="w-full"
                        type="button"
                        variant="outline"
                        onClick={() => {
                          handleCopy(accountAddress).catch((error: unknown) => {
                            reportError("Failed to copy address:", error);
                          });
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        {hasJustCopied ? t("common:copied") : t("common:copy")}
                      </Button>
                      <Button
                        className="w-full"
                        type="button"
                        variant="outline"
                        onClick={onViewInExplorer}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        {t("transfer:viewExplorer")}
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
                        <Label htmlFor="transfer-recipient">{t("transfer:sendTo")}</Label>
                        <FormControl>
                          <div className="relative">
                            <Input
                              {...field}
                              id="transfer-recipient"
                              value={field.value}
                              onChange={(event) => {
                                field.onChange(event);
                                clearErrors("receiverAddress");
                              }}
                              disabled={isSubmitting || isScanning}
                              placeholder={t("transfer:recipientPlaceholder")}
                              className={isInNativeApp() ? "pr-16" : "pr-10"}
                            />
                            <button
                              type="button"
                              onClick={() => { setAddressBookOpen(true); }}
                              disabled={isSubmitting || isScanning}
                              className={`absolute ${isInNativeApp() ? "right-9" : "right-2"} top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-accent transition-colors disabled:opacity-50`}
                              title={t("transfer:addressBook")}
                            >
                              <BookUser className="h-5 w-5 text-muted-foreground hover:text-foreground" />
                            </button>
                            {isInNativeApp() && (
                              <button
                                type="button"
                                onClick={handleScanQR}
                                disabled={isSubmitting || isScanning}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                                title={t("transfer:scanQr")}
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
                            {t("transfer:scanning")}
                          </div>
                        )}
                        {scanSuccess && scannedAddressPreview && (
                          <div className="flex items-center gap-2 text-sm text-green-600">
                            <Check className="h-4 w-4" />
                            <span>{t("transfer:scanned", { address: scannedAddressPreview })}</span>
                          </div>
                        )}
                        {!isScanning && !scanSuccess && (
                          <FormDescription>
                            {t(isInNativeApp() ? "transfer:recipientHintNative" : "transfer:recipientHint")}
                          </FormDescription>
                        )}
                        <RecipientResolutionStatus
                          resolution={recipientResolution}
                        />
                        <FormMessage translateMessage={(message) => transferMessage(message, t) ?? undefined} />
                      </FormItem>
                    )}
                  />

                  <AddressBookPicker
                    open={addressBookOpen}
                    onOpenChange={setAddressBookOpen}
                    currentAddress={formValues.receiverAddress}
                    onSelect={(address) => {
                      setValue("receiverAddress", address, {
                        shouldValidate: true,
                      });
                    }}
                  />

                  {/* Amount */}
                  <FormField
                    control={control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <div className="space-y-2">
                            <Label>{t("transfer:amount")}</Label>
                            <Input
                              placeholder={t("transfer:enterAmount")}
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
                                    parseFloat(toTemplateString(maxSendableBalance)) > 0
                                  ) {
                                    const percentage = Math.min(
                                      100,
                                      (numValue /
                                        parseFloat(toTemplateString(maxSendableBalance))) *
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
                            <Label>{t("transfer:percentage")}</Label>
                            <span className="font-numeric text-sm text-muted-foreground">
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
                                {pct === 100 ? t("transfer:max") : `${pct}%`}
                              </Button>
                            ))}
                          </div>
                          {isNativeTransfer && !percentageReady && (
                            <p className="text-xs text-muted-foreground">
                              {isUsingMobile
                                ? t("transfer:manualMobile")
                                : t("transfer:maxQuote")}
                            </p>
                          )}
                        </div>

                        <FormMessage translateMessage={(message) => transferMessage(message, t) ?? undefined} />
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
                          <Label>{t("transfer:pin")}</Label>
                          <FormControl>
                            <PinInput
                              length={6}
                              onChange={field.onChange}
                              value={field.value || ""}
                              disabled={isSubmitting}
                            />
                          </FormControl>
                          <FormDescription>
                            {t("transfer:pinHint")}
                          </FormDescription>
                          <FormMessage translateMessage={(message) => transferMessage(message, t) ?? undefined} />
                        </FormItem>
                      )}
                    />
                  )}

                  {/* Gas Fee Notice (only for native transfers). Hidden for
                      mobile-app accounts: the phone estimates its own gas and
                      presents the fee in its confirmation screen. */}
                  {isNativeTransfer && isUsingMobile && (
                    <p className="text-sm text-muted-foreground">
                      {t("transfer:mobileFee")}
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
                      onQuote={setApprovedFee}
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
                    {t("common:cancel")}
                  </Button>
                  <ShinyButton
                    disabled={
                      !isValid ||
                      !recipientResolution.address ||
                      stalePercentageAmount ||
                      nativeFeePending
                    }
                    processing={isSubmitting}
                    type="submit"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    {isSubmitting
                      ? t("transfer:sending", { asset: toTemplateString(assetSymbol) })
                      : t("transfer:send", { asset: toTemplateString(assetSymbol) })}
                  </ShinyButton>
                </CardFooter>
              </Card>
            </form>
          </Form>
        </PageShell>
    </>
  );
});

export default Transfer;
