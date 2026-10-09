import { Card } from "@/components/UI/Card";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { observer } from "mobx-react-lite";
import { useStore } from "../../../../stores/store";
import { useState } from "react";
import { ImportAccountForm } from "./ImportAccountForm/ImportAccountForm";
import { ImportEncryptedWallet } from "./ImportEncryptedWallet/ImportEncryptedWallet";
import { ImportHexSeedForm } from "./ImportHexSeedForm/ImportHexSeedForm";
import AccountImportSuccess from "./AccountImportSuccess/AccountImportSuccess";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/UI/Tabs";
import type { ExtendedWalletAccount } from "@/utils/crypto";
import { SEO } from "../../../SEO/SEO";
import { PinSetup } from "../PinSetup/PinSetup";
import { useWalletLimit } from "@/hooks/useWalletLimit";
import { AlertCircle } from "lucide-react";
import { Link } from "react-router";
import { ROUTES } from "@/router/router";
import { Button } from "@/components/UI/Button";
import { isDesktop } from "@/desktop/bridge";
import { walletMutations } from "@/utils/nativeWalletMutation";

const ImportAccount = observer(() => {
  const { qrlStore } = useStore();
  const { setActiveAccount, qrlConnection } = qrlStore;

  const [account, setAccount] = useState<ExtendedWalletAccount>();
  const [hasAccountImported, setHasAccountImported] = useState(false);
  const [isPinSetupComplete, setIsPinSetupComplete] = useState(false);

  const { isWalletLimitReached, walletCount, maxWallets } = useWalletLimit(
    qrlConnection.blockchain,
  );

  const onAccountImported = (importedAccount: ExtendedWalletAccount) => {
    if (!isDesktop && (!importedAccount.mnemonic || !importedAccount.hexSeed)) {
      throw new Error("The imported wallet is missing its recovery seed");
    }
    window.scrollTo(0, 0);
    setAccount(importedAccount);
    setHasAccountImported(true);
  };

  // Select only after PIN setup and the required native backup acknowledgement.
  // On desktop, the signer returns the provisioned address.
  const onPinSetupComplete = async (provisionedAddress?: string) => {
    const generation = walletMutations.captureGeneration();
    if (isDesktop && provisionedAddress) {
      setAccount((prev) =>
        prev ? { ...prev, address: provisionedAddress } : prev,
      );
      await setActiveAccount(provisionedAddress);
    } else if (!isDesktop && account?.address) {
      await setActiveAccount(account.address);
    }
    if (!isDesktop && !walletMutations.isCurrent(generation)) {
      throw new Error("Wallet was cleared during account import");
    }
    setIsPinSetupComplete(true);
  };

  if (hasAccountImported && !isWalletLimitReached) {
    if (isPinSetupComplete) return <AccountImportSuccess account={account} />;
    // Desktop accepts either recovery encoding. Web and native require both.
    if (
      account &&
      (isDesktop
        ? account.mnemonic || account.hexSeed
        : account.mnemonic && account.hexSeed)
    ) {
      return (
        <PinSetup
          accountAddress={account.address}
          mnemonic={account.mnemonic ?? ""}
          hexSeed={account.hexSeed ?? ""}
          onPinSetupComplete={onPinSetupComplete}
        />
      );
    }
    return <AccountImportSuccess account={account} />;
  }

  return (
    <>
      <SEO
        title="Import Account"
        description="Import your existing QRL account using a mnemonic phrase or encrypted wallet file. Securely access your quantum-resistant assets."
        keywords="Import QRL Account, Restore Wallet, Mnemonic Recovery, Encrypted Wallet Import"
      />
      <PageShell
        title={isWalletLimitReached ? "Wallet Limit Reached" : "Import Account"}
        subtitle={
          isWalletLimitReached
            ? undefined
            : "Restore your wallet with a recovery phrase, encrypted wallet file, or hex seed."
        }
      >
        <div className="relative z-10">
          {isWalletLimitReached ? (
            <Card className="flex flex-col items-center gap-6 p-6 text-center">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground">
                  You have reached the maximum limit of {maxWallets} wallets.
                  Please remove an existing wallet before importing a new one.
                </p>
                <p className="text-sm text-muted-foreground">
                  Current wallets: {walletCount} / {maxWallets}
                </p>
              </div>
              <Link to={ROUTES.ACCOUNT_LIST}>
                <Button variant="outline">Manage Wallets</Button>
              </Link>
            </Card>
          ) : (
            <Tabs defaultValue="mnemonic" className="w-full">
              <TabsList className="flex w-full flex-col sm:flex-row gap-2 rounded-none border-0 bg-transparent h-auto p-0">
                <TabsTrigger
                  value="mnemonic"
                  className="w-full text-sm py-3 px-4 rounded-lg border border-foreground/10 bg-foreground/[0.04] hover:bg-foreground/[0.08] data-[state=active]:border-primary/50 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-colors"
                >
                  Import with Mnemonic
                </TabsTrigger>
                {/* Encrypted-wallet-file restore and raw hex-seed import work
                      on desktop too: both forms recover the secret in-page
                      (exactly like typing a mnemonic) and hand it to the signer
                      via importWallet, which accepts mnemonic OR hexSeed. */}
                <TabsTrigger
                  value="encrypted"
                  className="w-full text-sm py-3 px-4 rounded-lg border border-foreground/10 bg-foreground/[0.04] hover:bg-foreground/[0.08] data-[state=active]:border-primary/50 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-colors"
                >
                  Import Encrypted Wallet
                </TabsTrigger>
                <TabsTrigger
                  value="hexseed"
                  className="w-full text-sm py-3 px-4 rounded-lg border border-foreground/10 bg-foreground/[0.04] hover:bg-foreground/[0.08] data-[state=active]:border-primary/50 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-colors"
                >
                  Import with Hex Seed
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="mnemonic"
                className="mt-6 w-full border-none outline-none focus-visible:ring-0"
              >
                <ImportAccountForm onAccountImported={onAccountImported} />
              </TabsContent>
              <TabsContent
                value="encrypted"
                className="mt-6 w-full border-none outline-none focus-visible:ring-0"
              >
                <ImportEncryptedWallet onWalletImported={onAccountImported} />
              </TabsContent>
              <TabsContent
                value="hexseed"
                className="mt-6 w-full border-none outline-none focus-visible:ring-0"
              >
                <ImportHexSeedForm onAccountImported={onAccountImported} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </PageShell>
    </>
  );
});

export default ImportAccount;
