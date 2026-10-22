import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { isRecord } from "@/utils/guards";
import { logger } from "@/utils/log";
import { accountSetupDescription } from "./accountSetupDescription";
import { Button } from "../../../../UI/Button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../../UI/Card";
import { ROUTES } from "../../../../../router/router";
import { useStore } from "../../../../../stores/store";
import { cva } from "class-variance-authority";
import { Download, Plus, Link2, Smartphone } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  connectWithProvider,
  discoverQrlProviders,
  type EIP6963ProviderDetail,
} from "@/utils/extension";
import {
  cancelMobilePairing,
  startMobilePairing,
} from "@/utils/mobileConnect/mobileConnection";
import ExtensionPickerDialog from "./ExtensionPickerDialog";
import MobilePairingDialog from "./MobilePairingDialog";
import { isInNativeApp } from "@/utils/nativeApp";
import { isDesktop } from "@/desktop/bridge";

const accountCreateImportClasses = cva("flex gap-8", {
  variants: {
    hasAccountCreationPreference: {
      true: ["flex-col-reverse"],
      false: ["flex-col"],
    },
  },
  defaultVariants: {
    hasAccountCreationPreference: false,
  },
});

const AccountCreateImport = observer(
  ({ showHeading = true }: { showHeading?: boolean }) => {
    const { t } = useTranslation(["home", "common"]);
    const state: unknown = useLocation().state;
    const { qrlStore } = useStore();
    const { activeAccount } = qrlStore;
    const { accountAddress } = activeAccount;
    const navigate = useNavigate();

    const hasActiveAccount = !!accountAddress;
    const hasAccountCreationPreference =
      isRecord(state) && state["hasAccountCreationPreference"] === true;
    const description = t(accountSetupDescription());

    const [pickerProviders, setPickerProviders] = useState<
      EIP6963ProviderDetail[] | null
    >(null);
    const [mobilePairing, setMobilePairing] = useState<{
      uri: string;
      installHint: string | null;
    } | null>(null);
    const [mobileConnectError, setMobileConnectError] = useState<ParseKeys<
      ["home", "common"]
    > | null>(null);

    // Close the pairing dialog once the store adopts the paired account (the
    // mobileConnection event wiring sets the provider on 'connect').
    const hasAdoptedMobileAccount =
      !!qrlStore.activeAccount.accountAddress &&
      qrlStore.activeAccountSource === "mobile";
    useEffect(() => {
      if (mobilePairing && hasAdoptedMobileAccount) {
        setMobilePairing(null);
        Promise.resolve(navigate(ROUTES.HOME)).catch((error: unknown) => {
          logger.error("Failed to open home:", error);
        });
      }
    }, [mobilePairing, hasAdoptedMobileAccount, navigate]);

    const finishConnect = async (detail: EIP6963ProviderDetail) => {
      setPickerProviders(null);
      const accounts = await connectWithProvider(
        detail,
        (address, source) => qrlStore.setActiveAccount(address, source),
        (provider) => {
          qrlStore.setExtensionProvider(provider);
        },
      );
      if (accounts && accounts.length > 0) {
        logger.log(
          "Successfully connected via extension, set active account, and stored provider.",
        );
        Promise.resolve(navigate(ROUTES.HOME)).catch((error: unknown) => {
          logger.error("Failed to open home:", error);
        });
      } else {
        logger.log("Failed to connect via extension or no accounts selected.");
      }
    };

    const handleConnectExtension = async () => {
      // Any QRL wallet extension (MyQRLWallet Extension or the upstream QRL
      // Web3 Wallet) may answer; one match connects directly, several open a
      // picker.
      const providers = await discoverQrlProviders();
      const only = providers[0];
      if (!only) {
        logger.error("QRL Wallet extension provider not found (EIP-6963).");
        alert(t("home:extensionMissing"));
        qrlStore.setExtensionProvider(null);
        return;
      }
      if (providers.length === 1) {
        await finishConnect(only);
        return;
      }
      setPickerProviders(providers);
    };

    const openMobilePairing = async (fresh: boolean) => {
      setMobileConnectError(null);
      try {
        const result = await startMobilePairing(qrlStore, fresh);
        // On mobile browsers a successful deep link foregrounds the app; the
        // relay events complete the pairing when the user returns.
        if (result.redirected) return;
        setMobilePairing({ uri: result.uri, installHint: result.installHint });
      } catch (error) {
        logger.error("Mobile pairing failed to start:", error);
        setMobileConnectError("home:pairingFailed");
      }
    };

    const handleConnectMobile = () => void openMobilePairing(false);

    const cancelPendingMobilePairing = async () => {
      try {
        await cancelMobilePairing();
        setMobilePairing(null);
      } catch (error) {
        logger.error("Mobile pairing cancellation failed:", error);
        setMobileConnectError("home:cancelPairingFailed");
      }
    };

    return (
      <div
        className={accountCreateImportClasses({ hasAccountCreationPreference })}
      >
        <Card className="w-full surface-ember">
          {showHeading && (
            <CardHeader>
              <CardTitle className="text-2xl font-bold">
                {hasActiveAccount ? t("home:addAccounts") : t("home:start")}
              </CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
          )}
          <CardFooter className={`flex-col gap-4 ${showHeading ? "" : "pt-6"}`}>
            <Link className="w-full" to={ROUTES.CREATE_ACCOUNT}>
              <Button className="w-full" type="button">
                <Plus className="mr-2 h-4 w-4" />
                {t("home:createAccount")}
              </Button>
            </Link>
            <Link className="w-full" to={ROUTES.IMPORT_ACCOUNT}>
              <Button className="w-full" type="button" variant="secondary">
                <Download className="mr-2 h-4 w-4" />
                {t("home:importAccount")}
              </Button>
            </Link>
            {/* The connect options are web-only. Hidden in the native app (it
              IS the mobile wallet) and on desktop (the signer is the wallet). */}
            {!isInNativeApp() && !isDesktop && (
              <>
                <Button
                  className="w-full"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    handleConnectExtension().catch((error: unknown) => {
                      logger.error(
                        "Failed to connect browser extension:",
                        error,
                      );
                    });
                  }}
                >
                  <Link2 className="mr-2 h-4 w-4" />
                  {t("home:connectExtension")}
                </Button>
                <Button
                  className="w-full"
                  type="button"
                  variant="outline"
                  onClick={handleConnectMobile}
                >
                  <Smartphone className="mr-2 h-4 w-4" />
                  {t("home:connectMobile")}
                </Button>
                {mobileConnectError && (
                  <p className="text-sm text-destructive">
                    {t(mobileConnectError)}
                  </p>
                )}
              </>
            )}
          </CardFooter>
        </Card>

        {pickerProviders ? (
          <ExtensionPickerDialog
            providers={pickerProviders}
            onSelect={(detail) => {
              finishConnect(detail).catch((error: unknown) => {
                logger.error("Failed to connect browser extension:", error);
              });
            }}
            onClose={() => {
              setPickerProviders(null);
            }}
          />
        ) : null}

        {mobilePairing ? (
          <MobilePairingDialog
            uri={mobilePairing.uri}
            installHint={mobilePairing.installHint}
            onClose={cancelPendingMobilePairing}
            onNewCode={() => openMobilePairing(true)}
          />
        ) : null}
      </div>
    );
  },
);

export default AccountCreateImport;
