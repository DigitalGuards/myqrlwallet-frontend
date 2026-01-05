import { observer } from "mobx-react-lite";
import { useStore } from "../../../../stores/store";
import { useState } from "react";
import { ImportAccountForm } from "./ImportAccountForm/ImportAccountForm";
import { ImportEncryptedWallet } from "./ImportEncryptedWallet/ImportEncryptedWallet";
import { ImportHexSeedForm } from "./ImportHexSeedForm/ImportHexSeedForm";
import AccountImportSuccess from "./AccountImportSuccess/AccountImportSuccess";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/UI/Tabs";
import { ExtendedWalletAccount } from "@/utils/crypto";
import { SEO } from "../../../SEO/SEO";
import { PinSetup } from "../PinSetup/PinSetup";

const ImportAccount = observer(() => {
  const { zondStore } = useStore();
  const { setActiveAccount } = zondStore;

  const [account, setAccount] = useState<ExtendedWalletAccount>();
  const [hasAccountImported, setHasAccountImported] = useState(false);
  const [isPinSetupComplete, setIsPinSetupComplete] = useState(false);

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
            {hasAccountImported ? (
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
