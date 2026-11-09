import { useTranslation } from "react-i18next";
import {
  assetMessage,
  assetPinError,
  assetServiceError,
  creationValidationMessage,
  type AssetMessage,
} from "@/i18n/assetMessage";
import { reportError } from "@/utils/reportError";
import {
  PinVerificationError,
  verifyPinWithLimit,
} from "@/utils/crypto/verifyPinWithLimit";
import { Checkbox } from "@/components/UI/CheckBox";
import { Button } from "../../../../UI/Button";
import { ShinyButton } from "../../../../UI/ShinyButton";
import { Card, CardContent, CardFooter } from "../../../../UI/Card";
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
import { observer } from "mobx-react-lite";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useEffect, useState } from "react";
import { useStore } from "@/stores/store";
import { useNavigate } from "react-router";
import { ROUTES } from "@/router/router";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import {
  DeviceCredentialUnavailableError,
  decryptStoredSeedWithPin,
} from "@/utils/crypto";
import {
  walletMutations,
  type WalletMutationToken,
} from "@/utils/nativeWalletMutation";
import { StorageUtil } from "@/utils/storage";
import { getAddressFromMnemonicAsync } from "@/utils/crypto";
import {
  captureSigningContext,
  type SigningContext,
} from "@/utils/signing/signingContext";
import { isDesktop } from "@/desktop/bridge";
import { Label } from "@/components/UI/Label";
import { isValidQrlAddress, QRL_ZERO_ADDRESS } from "@/utils/web3";
import {
  isValidTokenName,
  isValidTokenSymbol,
  parseTokenAmount,
  tokenDecimals,
} from "./tokenFormRules";
import { containsProfanity } from "@/utils/moderation";

type AmountField =
  | "initialSupply"
  | "maxSupply"
  | "maxWalletAmount"
  | "maxTransactionLimit";

function amountMessage(reason: "format" | "precision" | "range"): string {
  switch (reason) {
    case "format":
      return "creation:amountInvalid";
    case "precision":
      return "creation:amountPrecision";
    case "range":
      return "creation:amountTooLarge";
  }
}

// Everything here is written into an immutable contract, so each field is
// validated as typed and never rewritten (see tokenFormRules.ts). The first
// issue of a field is the one shown, so the checks are ordered by relevance.
const FormSchema = z
  .object({
    tokenName: z
      .string()
      .trim()
      .min(1, { message: "creation:nameRequired" })
      .refine(isValidTokenName, { message: "creation:nameInvalid" })
      .refine((value) => !containsProfanity(value), {
        message: "creation:profanity",
      }),
    tokenSymbol: z
      .string()
      .trim()
      .min(1, { message: "creation:symbolRequired" })
      .refine(isValidTokenSymbol, { message: "creation:symbolInvalid" })
      .refine((value) => !containsProfanity(value), {
        message: "creation:profanity",
      }),
    initialSupply: z.string().trim(),
    // The factory stores decimals as uint8; the form allows the common token
    // range of whole numbers from 1 to 18.
    decimals: z
      .string()
      .trim()
      .min(1, { message: "creation:decimalsRequired" })
      .refine((value) => tokenDecimals(value) !== null, {
        message: "creation:decimalsRange",
      }),
    mintable: z.boolean(),
    maxSupply: z.string().trim().optional(),
    changeInitialRecipient: z.boolean(),
    recipientAddress: z.string().trim().optional(),
    setMaxWalletAmount: z.boolean(),
    maxWalletAmount: z.string().trim().optional(),
    setMaxTransactionLimit: z.boolean(),
    maxTransactionLimit: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.changeInitialRecipient) {
      const recipient = data.recipientAddress ?? "";
      if (
        !isValidQrlAddress(recipient) ||
        recipient.toLowerCase() === QRL_ZERO_ADDRESS.toLowerCase()
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["recipientAddress"],
          message: "creation:recipientInvalid",
        });
      }
    }
    // Amounts depend on the decimals, which show their own message.
    const decimals = tokenDecimals(data.decimals);
    if (decimals === null) return;
    const amount = (
      field: AmountField,
      text: string,
      positive: boolean,
    ): bigint | null => {
      // An empty field means 0: missing where a positive amount is needed.
      if (text === "") {
        if (!positive) return 0n;
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "creation:amountPositive",
        });
        return null;
      }
      const parsed = parseTokenAmount(text, decimals);
      if (!parsed.ok) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: amountMessage(parsed.reason),
        });
        return null;
      }
      if (positive && parsed.units === 0n) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "creation:amountPositive",
        });
        return null;
      }
      return parsed.units;
    };
    // Without minting the initial supply is the whole supply, which the
    // contract requires to be above zero.
    const initial = amount("initialSupply", data.initialSupply, !data.mintable);
    if (data.mintable) {
      const max = amount("maxSupply", data.maxSupply ?? "", true);
      if (initial !== null && max !== null && max < initial) {
        ctx.addIssue({
          code: "custom",
          path: ["maxSupply"],
          message: "creation:maxSupplyBelowInitial",
        });
      }
    }
    if (data.setMaxWalletAmount)
      amount("maxWalletAmount", data.maxWalletAmount ?? "", true);
    if (data.setMaxTransactionLimit)
      amount("maxTransactionLimit", data.maxTransactionLimit ?? "", true);
  });

type TokenCreationFormProps = {
  onTokenCreated: (
    tokenName: string,
    tokenSymbol: string,
    initialSupply: string,
    decimals: number,
    maxSupply: undefined | string,
    initialRecipient: undefined | string,
    maxWalletAmount: undefined | string,
    maxTransactionLimit: undefined | string,
    mnemonicPhrases: string,
  ) => Promise<void>;
  /**
   * Told while a submission runs, so the page holds its Back: the
   * submission opens the status page when it finishes.
   */
  onBusyChange?: (busy: boolean) => void;
};

const WALLET_CHANGED = "Wallet changed while preparing token creation";

export const TokenCreationForm = observer(
  ({ onTokenCreated, onBusyChange }: TokenCreationFormProps) => {
    const { t } = useTranslation([
      "creation",
      "nfts",
      "tokens",
      "home",
      "transfer",
      "settings",
      "onboarding",
      "common",
    ]);
    const navigate = useNavigate();
    const { qrlStore, tokenStore } = useStore();
    const { activeAccount, activeAccountSource } = qrlStore;
    const [pin, setPin] = useState("");
    const [pinError, setPinError] = useState<AssetMessage | null>(null);
    const [formError, setFormError] = useState<AssetMessage | null>(null);

    const form = useForm({
      resolver: zodResolver(FormSchema),
      mode: "onChange",
      reValidateMode: "onSubmit",
      defaultValues: {
        tokenName: "",
        tokenSymbol: "",
        initialSupply: "",
        decimals: "18",
        mintable: false,
        changeInitialRecipient: false,
        setMaxWalletAmount: false,
        setMaxTransactionLimit: false,
      },
    });
    const {
      handleSubmit,
      control,
      formState: { isSubmitting, isValid },
    } = form;

    // Extension and mobile-app accounts have no local seed; token
    // creation needs one, so both are blocked below.
    const isUsingRemoteSigner =
      activeAccountSource === "extension" || activeAccountSource === "mobile";

    // The on-chain value of an amount: the number entered, in the token's
    // smallest units, exactly as it is submitted.
    const realValue = (text: string): string => {
      const decimals = tokenDecimals(form.watch("decimals"));
      if (decimals === null) return t("creation:invalidValue");
      const parsed = parseTokenAmount(text, decimals);
      return parsed.ok ? parsed.units.toString() : t("creation:invalidValue");
    };

    async function onSubmit(formData: z.output<typeof FormSchema>) {
      try {
        setPinError(null);
        setFormError(null);

        // Check if account exists
        if (!activeAccount.accountAddress) {
          await navigate(ROUTES.IMPORT_ACCOUNT);
          return;
        }

        // Remote-signer wallets cannot create tokens yet
        if (isUsingRemoteSigner) {
          setFormError({ key: "creation:remoteUnsupported" });
          return;
        }

        // Get encrypted seed and validate PIN (only for web/native
        // seed accounts). On desktop there is no PIN and no seed in the
        // renderer: the store builds the calldata and routes through
        // the signer, so we pass an empty mnemonic placeholder.
        let mnemonicPhrase = "";
        let signingGeneration: WalletMutationToken | null = null;
        let signingContext: SigningContext | null = null;
        if (!isDesktop) {
          if (!pin) {
            setPinError({ key: "creation:pinRequired" });
            return;
          }

          const pinGeneration = walletMutations.captureGeneration();
          signingGeneration = pinGeneration;
          signingContext = captureSigningContext(qrlStore, {
            message: WALLET_CHANGED,
            account: activeAccount.accountAddress,
          });
          const selectedBlockChain = await StorageUtil.getBlockChain();
          const encryptedSeed = await StorageUtil.getEncryptedSeed(
            selectedBlockChain,
            activeAccount.accountAddress,
          );

          if (!encryptedSeed) {
            setPinError({ key: "creation:noSeed" });
            return;
          }

          // Decrypt the seed using the PIN. Keep the worker-derive
          // call OUTSIDE this try block : a crash inside the
          // crypto worker is not a wrong-PIN error and shouldn't
          // be misreported as one.
          try {
            const decryptedSeed = await verifyPinWithLimit(() =>
              decryptStoredSeedWithPin(
                selectedBlockChain,
                activeAccount.accountAddress,
                encryptedSeed,
                pin,
                pinGeneration,
              ),
            );
            mnemonicPhrase = decryptedSeed.mnemonic;
          } catch (error) {
            setPinError(
              error instanceof PinVerificationError
                ? assetPinError(error)
                : error instanceof DeviceCredentialUnavailableError
                  ? { key: "creation:credentialUnavailable" }
                  : { key: "transfer:unlockFailed" },
            );
            return;
          }

          // Verify the mnemonic corresponds to the active account.
          // MLDSA87 derivation runs in the crypto worker; any
          // failure here propagates to the outer onSubmit handler
          // and surfaces as a worker / system error rather than
          // "invalid PIN".
          const qrlInstance = qrlStore.qrlInstance;
          if (!qrlInstance) {
            setPinError({ key: "transfer:notConnected" });
            return;
          }
          const address = await getAddressFromMnemonicAsync(
            mnemonicPhrase,
            qrlInstance,
          );
          if (address !== activeAccount.accountAddress) {
            setPinError({ key: "creation:wrongWallet" });
            return;
          }
        }

        if (
          signingGeneration &&
          !walletMutations.isCurrent(signingGeneration)
        ) {
          throw new Error(WALLET_CHANGED);
        }
        signingContext?.assertUnchanged();

        const tokenName = formData.tokenName;
        const tokenSymbol = formData.tokenSymbol;
        // The schema has already validated every value used here. Optional
        // values count only while their box is ticked: unticking hides a
        // field without clearing it.
        const decimals = tokenDecimals(formData.decimals);
        if (decimals === null) throw new Error("Invalid token decimals");
        const units = (text: string): string => {
          const parsed = parseTokenAmount(text, decimals);
          if (!parsed.ok) throw new Error("Invalid token amount");
          return parsed.units.toString();
        };
        // An empty initial supply is valid only for a mintable token (0).
        const initialSupply =
          formData.initialSupply === "" ? "0" : units(formData.initialSupply);
        const maxSupply = formData.mintable
          ? units(formData.maxSupply ?? "")
          : undefined;
        const recipientAddress = formData.changeInitialRecipient
          ? formData.recipientAddress
          : undefined;
        const maxWalletAmount = formData.setMaxWalletAmount
          ? units(formData.maxWalletAmount ?? "")
          : undefined;
        const maxTransactionLimit = formData.setMaxTransactionLimit
          ? units(formData.maxTransactionLimit ?? "")
          : undefined;

        // Navigate immediately to show loading state, then start creation.
        // The status page takes this form's place in history, so its Back
        // returns to the page that opened the form.
        await tokenStore.setCreatingToken(tokenName, true);
        Promise.resolve(navigate(ROUTES.TOKEN_STATUS, { replace: true })).catch(
          (error: unknown) => {
            reportError("Failed to open token status:", error);
          },
        );

        // The two awaits above gave the wallet one more chance to change.
        // Nothing has been signed yet: say so on the status page, which is
        // already opening, and stop.
        try {
          signingContext?.assertUnchanged();
        } catch (error) {
          await tokenStore.setCreatingToken(
            "",
            false,
            error instanceof Error ? error.message : WALLET_CHANGED,
          );
          throw error;
        }

        // Start token creation in background (don't await here)
        onTokenCreated(
          tokenName,
          tokenSymbol,
          initialSupply,
          decimals,
          maxSupply,
          recipientAddress,
          maxWalletAmount,
          maxTransactionLimit,
          mnemonicPhrase,
        ).catch((error: unknown) => {
          reportError("Token creation failed:", error);
          // The error state is set within tokenStore and displayed on the status page
        });
      } catch (error) {
        reportError("Error creating token:", error);
        setFormError(
          error instanceof Error && error.message === WALLET_CHANGED
            ? assetServiceError(error.message)
            : { key: "creation:failed" },
        );
      }
    }

    useEffect(() => {
      form.reset({
        tokenName: "",
        tokenSymbol: "",
        initialSupply: "",
        decimals: "18",
        mintable: false,
        changeInitialRecipient: false,
        setMaxWalletAmount: false,
        setMaxTransactionLimit: false,
      });
    }, [form]);

    useEffect(() => {
      if (!isSubmitting || !onBusyChange) return;
      onBusyChange(true);
      return () => {
        onBusyChange(false);
      };
    }, [isSubmitting, onBusyChange]);

    // Check if user has an active account
    if (!activeAccount.accountAddress) {
      return (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <p className="text-muted-foreground mb-4">
                {t("creation:accountRequired")}
              </p>
              <Button
                onClick={() => {
                  Promise.resolve(navigate(ROUTES.IMPORT_ACCOUNT)).catch(
                    (error: unknown) => {
                      reportError("Failed to open account import:", error);
                    },
                  );
                }}
              >
                {t("transfer:importAccount")}
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Form {...form}>
        <form
          className="w-full"
          onSubmit={(event) => {
            handleSubmit(onSubmit)(event).catch((error: unknown) => {
              reportError("Error creating token:", error);
              setFormError({ key: "creation:failed" });
            });
          }}
        >
          <Card>
            <CardContent className="space-y-8 pt-6">
              {formError && (
                <div
                  role="alert"
                  className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
                >
                  {assetMessage(formError, t)}
                </div>
              )}
              <FormField
                control={control}
                name="tokenName"
                render={({ field }) => (
                  <FormItem>
                    <Label>{t("creation:name")}</Label>
                    <FormControl>
                      <Input
                        disabled={isSubmitting}
                        placeholder={t("creation:namePlaceholder")}
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage
                      translateMessage={(message) =>
                        creationValidationMessage(message, t)
                      }
                    />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="tokenSymbol"
                render={({ field }) => (
                  <FormItem>
                    <Label>{t("creation:symbol")}</Label>
                    <FormControl>
                      <Input
                        {...field}
                        disabled={isSubmitting}
                        placeholder={t("creation:symbolPlaceholder")}
                        type="text"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                      />
                    </FormControl>
                    <FormMessage
                      translateMessage={(message) =>
                        creationValidationMessage(message, t)
                      }
                    />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="initialSupply"
                render={({ field }) => (
                  <FormItem>
                    <Label>{t("creation:initialSupply")}</Label>
                    <FormControl>
                      <Input
                        {...field}
                        disabled={isSubmitting}
                        placeholder={t("creation:supplyPlaceholder")}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                      />
                    </FormControl>
                    <FormMessage
                      translateMessage={(message) =>
                        creationValidationMessage(message, t)
                      }
                    />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="decimals"
                render={({ field }) => (
                  <FormItem>
                    <Label>{t("creation:decimals")}</Label>
                    <FormControl>
                      <Input
                        {...field}
                        disabled={isSubmitting}
                        placeholder={t("creation:decimalsPlaceholder")}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                      />
                    </FormControl>
                    <FormMessage
                      translateMessage={(message) =>
                        creationValidationMessage(message, t)
                      }
                    />
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
                          {t("creation:mintable")}
                        </label>
                      </div>
                    </FormControl>
                    <FormMessage
                      translateMessage={(message) =>
                        creationValidationMessage(message, t)
                      }
                    />
                  </FormItem>
                )}
              />
              {form.watch("mintable") && (
                <FormField
                  control={control}
                  name="maxSupply"
                  render={({ field }) => (
                    <FormItem>
                      <Label>{t("creation:maxSupply")}</Label>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={isSubmitting}
                          placeholder={t("creation:limitPlaceholder")}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                        />
                      </FormControl>
                      <FormDescription className="[overflow-wrap:anywhere]">
                        {t("creation:realValue", {
                          value: realValue(field.value ?? ""),
                        })}
                      </FormDescription>
                      <FormMessage
                        translateMessage={(message) =>
                          creationValidationMessage(message, t)
                        }
                      />
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
                          {t("creation:changeRecipient")}
                        </label>
                      </div>
                    </FormControl>
                    <FormMessage
                      translateMessage={(message) =>
                        creationValidationMessage(message, t)
                      }
                    />
                  </FormItem>
                )}
              />
              {form.watch("changeInitialRecipient") && (
                <FormField
                  control={control}
                  name="recipientAddress"
                  render={({ field }) => (
                    <FormItem>
                      <Label>{t("creation:recipientAddress")}</Label>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={isSubmitting}
                          placeholder={t("creation:recipientPlaceholder")}
                          type="text"
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                      </FormControl>
                      <FormMessage
                        translateMessage={(message) =>
                          creationValidationMessage(message, t)
                        }
                      />
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
                          {t("creation:maxWallet")}
                        </label>
                      </div>
                    </FormControl>
                    <FormMessage
                      translateMessage={(message) =>
                        creationValidationMessage(message, t)
                      }
                    />
                  </FormItem>
                )}
              />
              {form.watch("setMaxWalletAmount") && (
                <FormField
                  control={control}
                  name="maxWalletAmount"
                  render={({ field }) => (
                    <FormItem>
                      <Label>{t("creation:maxWallet")}</Label>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={isSubmitting}
                          placeholder={t("creation:limitPlaceholder")}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                        />
                      </FormControl>
                      <FormMessage
                        translateMessage={(message) =>
                          creationValidationMessage(message, t)
                        }
                      />
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
                          {t("creation:maxTransaction")}
                        </label>
                      </div>
                    </FormControl>
                    <FormMessage
                      translateMessage={(message) =>
                        creationValidationMessage(message, t)
                      }
                    />
                  </FormItem>
                )}
              />
              {form.watch("setMaxTransactionLimit") && (
                <FormField
                  control={control}
                  name="maxTransactionLimit"
                  render={({ field }) => (
                    <FormItem>
                      <Label>{t("creation:maxTransaction")}</Label>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={isSubmitting}
                          placeholder={t("creation:limitPlaceholder")}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                        />
                      </FormControl>
                      <FormMessage
                        translateMessage={(message) =>
                          creationValidationMessage(message, t)
                        }
                      />
                    </FormItem>
                  )}
                />
              )}

              {isUsingRemoteSigner ? (
                <div className="flex flex-col p-4 bg-yellow-900/20 rounded-lg">
                  <p className="text-sm text-yellow-200">
                    {t("creation:remoteHint")}
                  </p>
                </div>
              ) : !isDesktop ? (
                // PIN entry is web/native only. On desktop the signer
                // session authorizes the transaction (no PIN).
                <div className="flex flex-col">
                  <Label htmlFor="pin" className="mb-2">
                    {t("creation:transactionPin")}
                  </Label>
                  <PinInput
                    length={6}
                    placeholder={t("creation:pinPlaceholder")}
                    value={pin}
                    onChange={setPin}
                    disabled={isSubmitting}
                    description={t("creation:pinHint")}
                    error={assetMessage(pinError, t)}
                  />
                </div>
              ) : null}
            </CardContent>
            <CardFooter>
              <ShinyButton
                disabled={
                  !isValid ||
                  (!isUsingRemoteSigner && !isDesktop && pin.length === 0) ||
                  isUsingRemoteSigner
                }
                processing={isSubmitting}
                className="w-full"
                type="submit"
              >
                {isSubmitting
                  ? t("creation:creatingButton")
                  : t("creation:create")}
              </ShinyButton>
            </CardFooter>
          </Card>
        </form>
      </Form>
    );
  },
);
