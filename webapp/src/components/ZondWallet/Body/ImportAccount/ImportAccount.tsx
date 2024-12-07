import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { ImportAccountForm } from "./ImportAccountForm/ImportAccountForm";
import { ImportEncryptedWallet } from "./ImportEncryptedWallet/ImportEncryptedWallet";
import { ImportHexSeedForm } from "./ImportHexSeedForm/ImportHexSeedForm";
import AccountImportSuccess from "./AccountImportSuccess/AccountImportSuccess";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/UI/Tabs";
import { ExtendedWalletAccount } from "@/utilities/walletEncryptionUtil";

const ImportAccount = observer(() => {
  const { zondStore } = useStore();
  const { setActiveAccount } = zondStore;

  const [account, setAccount] = useState<ExtendedWalletAccount>();
  const [hasAccountImported, setHasAccountImported] = useState(false);

  const onAccountImported = async (importedAccount: ExtendedWalletAccount) => {
    window.scrollTo(0, 0);
    setAccount(importedAccount);
    await setActiveAccount(importedAccount.address);
    setHasAccountImported(true);
  };

  return (
    <div className="flex w-full items-start justify-center pt-16">
      <div className="relative w-full max-w-2xl px-4">
        <img
          className="fixed left-0 top-0 z-0 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-30"
          src="/tree.svg"
          alt="Background Tree"
        />
        <div className="relative z-10">
          {hasAccountImported ? (
            <AccountImportSuccess account={account} />
          ) : (
            <Tabs defaultValue="mnemonic">
              <TabsList className="w-full">
                <TabsTrigger value="mnemonic" className="w-full">
                  Import with Mnemonic
                </TabsTrigger>
                <TabsTrigger value="encrypted" className="w-full">
                  Import Encrypted Wallet
                </TabsTrigger>
                <TabsTrigger value="hexseed" className="w-full">
                  Import with Hex Seed
                </TabsTrigger>
              </TabsList>
              <TabsContent value="mnemonic">
                <ImportAccountForm onAccountImported={onAccountImported} />
              </TabsContent>
              <TabsContent value="encrypted">
                <ImportEncryptedWallet onWalletImported={onAccountImported} />
              </TabsContent>
              <TabsContent value="hexseed">
                <ImportHexSeedForm onAccountImported={onAccountImported} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
});

export default ImportAccount;
