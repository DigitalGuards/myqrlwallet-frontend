import { observer } from "mobx-react-lite";
import { useStore } from "../../../../stores/store";
import { useState, useEffect } from "react";
import { ImportAccountForm } from "./ImportAccountForm/ImportAccountForm";
import { ImportEncryptedWallet } from "./ImportEncryptedWallet/ImportEncryptedWallet";
import { ImportHexSeedForm } from "./ImportHexSeedForm/ImportHexSeedForm";
import AccountImportSuccess from "./AccountImportSuccess/AccountImportSuccess";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/UI/Tabs";
import { ExtendedWalletAccount } from "@/utils/crypto";
import { SEO } from "../../../SEO/SEO";
import { PinSetup } from "../PinSetup/PinSetup";
import { StorageUtil } from "@/utils/storage";
import { AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { ROUTES } from "@/router/router";
import { Button } from "@/components/UI/Button";

const ImportAccount = observer(() => {
  const { zondStore } = useStore();
  const { setActiveAccount, zondConnection } = zondStore;

  const [account, setAccount] = useState<ExtendedWalletAccount>();
  const [hasAccountImported, setHasAccountImported] = useState(false);
  const [isPinSetupComplete, setIsPinSetupComplete] = useState(false);
  const [isWalletLimitReached, setIsWalletLimitReached] = useState(false);
  const [walletCount, setWalletCount] = useState(0);

  const maxWallets = StorageUtil.getMaxWallets();

  useEffect(() => {
    const checkWalletLimit = async () => {
      if (zondConnection.blockchain) {
        const limitReached = await StorageUtil.isWalletLimitReached(zondConnection.blockchain);
        const count = await StorageUtil.getWalletCount(zondConnection.blockchain);
        setIsWalletLimitReached(limitReached);
        setWalletCount(count);
      }
    };
    checkWalletLimit();
  }, [zondConnection.blockchain]);

  const onAccountImported = async (importedAccount: ExtendedWalletAccount) => {
    window.scrollTo(0, 0);
    setAccount(importedAccount);
    await setActiveAccount(importedAccount.address);
    setHasAccountImported(true);
  };

  const onPinSetupComplete = () => {
    setIsPinSetupComplete(true);
  };

  return (
    <>
      <SEO
        title="Import Account"
        description="Import your existing QRL account using a mnemonic phrase or encrypted wallet file. Securely access your quantum-resistant assets."
        keywords="Import QRL Account, Restore Wallet, Mnemonic Recovery, Encrypted Wallet Import"
      />
      <div className="flex w-full items-start justify-center pt-16">
        <div className="relative w-full max-w-2xl px-4">
          <img
            className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
            src="/tree.svg"
            alt="Background Tree"
          />
          <div className="relative z-10">
            {isWalletLimitReached ? (
              <div className="flex flex-col items-center gap-6 rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
                <AlertCircle className="h-12 w-12 text-destructive" />
                <div className="flex flex-col gap-2">
                  <h2 className="text-xl font-semibold text-foreground">
                    Wallet Limit Reached
                  </h2>
                  <p className="text-muted-foreground">
                    You have reached the maximum limit of {maxWallets} wallets.
                    Please remove an existing wallet before importing a new one.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Current wallets: {walletCount} / {maxWallets}
                  </p>
                </div>
                <Link to={ROUTES.ACCOUNT_LIST}>
                  <Button variant="outline">
                    Manage Wallets
                  </Button>
                </Link>
              </div>
            ) : hasAccountImported ? (
              isPinSetupComplete ? (
                <AccountImportSuccess account={account} />
              ) : (
                account && account.mnemonic && account.hexSeed ? (
                  <PinSetup
                    accountAddress={account.address}
                    mnemonic={account.mnemonic}
                    hexSeed={account.hexSeed}
                    onPinSetupComplete={onPinSetupComplete}
                  />
                ) : (
                  <AccountImportSuccess account={account} />
                )
              )
            ) : (
              <Tabs defaultValue="mnemonic" className="w-full">
                <TabsList className="flex w-full flex-col sm:flex-row gap-2 bg-transparent h-auto p-0">
                  <TabsTrigger
                    value="mnemonic"
                    className="w-full text-sm py-3 px-4 rounded-lg bg-card border border-border hover:bg-accent data-[state=active]:border-secondary data-[state=active]:bg-secondary/10 transition-colors"
                  >
                    Import with Mnemonic
                  </TabsTrigger>
                  <TabsTrigger
                    value="encrypted"
                    className="w-full text-sm py-3 px-4 rounded-lg bg-card border border-border hover:bg-accent data-[state=active]:border-secondary data-[state=active]:bg-secondary/10 transition-colors"
                  >
                    Import Encrypted Wallet
                  </TabsTrigger>
                  <TabsTrigger
                    value="hexseed"
                    className="w-full text-sm py-3 px-4 rounded-lg bg-card border border-border hover:bg-accent data-[state=active]:border-secondary data-[state=active]:bg-secondary/10 transition-colors"
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
        </div>
      </div>
    </>
  );
});

export default ImportAccount;
