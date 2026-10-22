import { useTranslation } from "react-i18next";
import {
  assetMessage,
  assetPinError,
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
import { formatUnits, parseUnits } from "@/utils/web3/units";
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
import { isDesktop } from "@/desktop/bridge";
import { Label } from "@/components/UI/Label";
import { isValidQrlAddress } from "@/utils/web3";
import { containsProfanity } from "@/utils/moderation";

const FormSchema = z
  .object({
    tokenName: z
      .string()
      .min(1, { message: "creation:nameRequired" })
      .refine((value) => !containsProfanity(value), {
        message: "creation:profanity",
      }),
    tokenSymbol: z
      .string()
      .min(1, { message: "creation:symbolRequired" })
      .refine((value) => !containsProfanity(value), {
        message: "creation:profanity",
      }),
    initialSupply: z.string(),
    decimals: z.number().min(1, { message: "creation:decimalsRequired" }),
    mintable: z.boolean(),
    maxSupply: z.string().optional(),
    changeInitialRecipient: z.boolean(),
    recipientAddress: z.string().optional(),
    setMaxWalletAmount: z.boolean(),
    maxWalletAmount: z.string().optional(),
    setMaxTransactionLimit: z.boolean(),
    maxTransactionLimit: z.string().optional(),
  })
  .refine(
    (data) => {
      // Validate recipient address if changeInitialRecipient is true
      if (data.changeInitialRecipient && data.recipientAddress) {
        return isValidQrlAddress(data.recipientAddress);
      }
      return true;
    },
    {
      message: "creation:recipientInvalid",
      path: ["recipientAddress"],
    },
  );

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
};

export const TokenCreationForm = observer(
  ({ onTokenCreated }: TokenCreationFormProps) => {
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
        initialSupply: "0",
        decimals: 18,
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

    const formatRealValue = (supply: string, decimals: number) => {
      try {
        return formatUnits(supply, decimals);
      } catch {
        return t("creation:invalidValue");
      }
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
        if (!isDesktop) {
          if (!pin) {
            setPinError({ key: "creation:pinRequired" });
            return;
          }

          const pinGeneration = walletMutations.captureGeneration();
          signingGeneration = pinGeneration;
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
          throw new Error("Wallet changed while preparing token creation");
        }

        const tokenName = formData.tokenName;
        const tokenSymbol = formData.tokenSymbol;
        const initialSupply = parseUnits(
          formData.initialSupply,
          formData.decimals,
        ).toString();
        const decimals = formData.decimals;
        const maxSupply = formData.maxSupply
          ? parseUnits(formData.maxSupply, decimals).toString()
          : undefined;
        const recipientAddress = formData.recipientAddress;
        const maxWalletAmount = formData.maxWalletAmount
          ? parseUnits(formData.maxWalletAmount, decimals).toString()
          : undefined;
        const maxTransactionLimit = formData.maxTransactionLimit
          ? parseUnits(formData.maxTransactionLimit, decimals).toString()
          : undefined;

        // Navigate immediately to show loading state, then start creation
        await tokenStore.setCreatingToken(tokenName, true);
        Promise.resolve(navigate(ROUTES.TOKEN_STATUS)).catch(
          (error: unknown) => {
            reportError("Failed to open token status:", error);
          },
        );

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
        setFormError({ key: "creation:failed" });
      }
    }

    useEffect(() => {
      form.reset({
        tokenName: "",
        tokenSymbol: "",
        initialSupply: "0",
        decimals: 18,
        mintable: false,
        changeInitialRecipient: false,
        setMaxWalletAmount: false,
        setMaxTransactionLimit: false,
      });
    }, [form]);

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
                        type="number"
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
                        type="number"
                        onChange={(e) => {
                          field.onChange(Number(e.target.value));
                        }}
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
                        />
                      </FormControl>
                      <FormDescription>
                        {t("creation:realValue", {
                          value: formatRealValue(
                            field.value || "0",
                            form.watch("decimals"),
                          ),
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
                          type="number"
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
                          type="number"
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
