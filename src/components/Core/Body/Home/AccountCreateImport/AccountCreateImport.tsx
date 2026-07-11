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
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  connectWithProvider,
  discoverQrlProviders,
  type EIP6963ProviderDetail,
} from "@/utils/extension";
import { startMobilePairing } from "@/utils/mobileConnect/mobileConnection";
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

const AccountCreateImport = observer(() => {
  const { state } = useLocation();
  const { qrlStore } = useStore();
  const { activeAccount, setActiveAccount, setExtensionProvider } = qrlStore;
  const { accountAddress } = activeAccount;
  const navigate = useNavigate();

  const hasActiveAccount = !!accountAddress;
  const hasAccountCreationPreference = !!state?.hasAccountCreationPreference;
  // The connect options (browser extension, mobile app pairing) are web-only:
  // hidden in the native app (it IS the mobile wallet) and the desktop app
  // (the signer is the wallet). The copy drops their mention there too.
  const description = (isInNativeApp() || isDesktop)
    ? "You are connected to the blockchain. Create a new account or import an existing account."
    : "You are connected to the blockchain. Create a new account, import an existing account, or connect a wallet you already use: your browser extension or the MyQRLWallet mobile app.";

  const [pickerProviders, setPickerProviders] = useState<EIP6963ProviderDetail[] | null>(null);
  const [mobilePairing, setMobilePairing] = useState<{ uri: string; installHint: string | null } | null>(null);
  const [mobileConnectError, setMobileConnectError] = useState<string | null>(null);

  // Close the pairing dialog once the store adopts the paired account (the
  // mobileConnection event wiring sets the provider on 'connect').
  const isMobileProviderSet = !!qrlStore.mobileProvider;
  useEffect(() => {
    if (mobilePairing && isMobileProviderSet) {
      setMobilePairing(null);
      navigate(ROUTES.HOME);
    }
  }, [mobilePairing, isMobileProviderSet, navigate]);

  const finishConnect = async (detail: EIP6963ProviderDetail) => {
    setPickerProviders(null);
    const accounts = await connectWithProvider(detail, setActiveAccount, setExtensionProvider);
    if (accounts && accounts.length > 0) {
      console.log("Successfully connected via extension, set active account, and stored provider.");
      navigate(ROUTES.HOME);
    } else {
      console.log("Failed to connect via extension or no accounts selected.");
    }
  };

  const handleConnectExtension = async () => {
    // Any QRL wallet extension (MyQRLWallet Extension or the upstream QRL
    // Web3 Wallet) may answer; one match connects directly, several open a
    // picker.
    const providers = await discoverQrlProviders();
    const only = providers[0];
    if (!only) {
      console.error("QRL Wallet extension provider not found (EIP-6963).");
      alert("QRL Wallet Extension not detected. Please ensure it is installed and enabled.");
      setExtensionProvider(null);
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
      console.error("Mobile pairing failed to start:", error);
      setMobileConnectError(
        `Could not start mobile pairing: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleConnectMobile = () => void openMobilePairing(false);

  return (
    <div
      className={accountCreateImportClasses({ hasAccountCreationPreference })}
    >
      <Card className="w-full surface-ember">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">
            {hasActiveAccount ? "Add accounts" : "Let's start"}
          </CardTitle>
          <CardDescription>
            {description}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex-col gap-4">
          <Link className="w-full" to={ROUTES.CREATE_ACCOUNT}>
            <Button className="w-full" type="button">
              <Plus className="mr-2 h-4 w-4" />
              Create a new account
            </Button>
          </Link>
          <Link className="w-full" to={ROUTES.IMPORT_ACCOUNT}>
            <Button className="w-full" type="button" variant="secondary">
              <Download className="mr-2 h-4 w-4" />
              Import an existing account
            </Button>
          </Link>
          {/* The connect options are web-only. Hidden in the native app (it
              IS the mobile wallet) and on desktop (the signer is the wallet). */}
          {!isInNativeApp() && !isDesktop && (
            <>
              <Button className="w-full" type="button" variant="outline" onClick={handleConnectExtension}>
                <Link2 className="mr-2 h-4 w-4" />
                Connect Browser Extension
              </Button>
              <Button className="w-full" type="button" variant="outline" onClick={handleConnectMobile}>
                <Smartphone className="mr-2 h-4 w-4" />
                Connect Mobile App
              </Button>
              {mobileConnectError && (
                <p className="text-sm text-destructive">{mobileConnectError}</p>
              )}
            </>
          )}
        </CardFooter>
      </Card>

      {pickerProviders ? (
        <ExtensionPickerDialog
          providers={pickerProviders}
          onSelect={(detail) => void finishConnect(detail)}
          onClose={() => setPickerProviders(null)}
        />
      ) : null}

      {mobilePairing ? (
        <MobilePairingDialog
          uri={mobilePairing.uri}
          installHint={mobilePairing.installHint}
          onClose={() => setMobilePairing(null)}
          onNewCode={() => openMobilePairing(true)}
        />
      ) : null}
    </div>
  );
});

export default AccountCreateImport;
