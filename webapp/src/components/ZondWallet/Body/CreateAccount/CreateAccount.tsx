import { lazy, useState } from "react";
import withSuspense from "../../../../functions/withSuspense";
import { SEO } from "../../../SEO/SEO";
import { useStore } from "../../../../stores/store";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { observer } from "mobx-react-lite";
import { AccountCreationForm } from "./AccountCreationForm/AccountCreationForm";
import { AccountCreationSuccess } from "./AccountCreationSuccess/AccountCreationSuccess";

const MnemonicDisplay = withSuspense(
  lazy(() => import("./MnemonicDisplay/MnemonicDisplay"))
);

const CreateAccount = observer(() => {
  const { zondStore } = useStore();
  const { setActiveAccount } = zondStore;

  const [account, setAccount] = useState<Web3BaseWalletAccount>();
  const [hasAccountCreated, setHasAccountCreated] = useState(false);
  const [hasMnemonicNoted, setHasMnemonicNoted] = useState(false);
  const [userPassword, setUserPassword] = useState<string>("");
  const [mnemonic, setMnemonic] = useState<string>("");
  const [hexSeed, setHexSeed] = useState<string>("");

  const onAccountCreated = async (newAccount: Web3BaseWalletAccount, password: string) => {
    if (newAccount?.address) {
      window.scrollTo(0, 0);
      setAccount(newAccount);
      setUserPassword(password);
      await setActiveAccount(newAccount.address);
      setHasAccountCreated(true);
    }
  };

  const onMnemonicNoted = (notedMnemonic: string, notedHexSeed: string) => {
    window.scrollTo(0, 0);
    setMnemonic(notedMnemonic);
    setHexSeed(notedHexSeed);
    setHasMnemonicNoted(true);
  };

  return (
    <>
      <SEO
        title="Create Account"
        description="Create a new quantum-resistant QRL account. Generate a secure wallet with post-quantum cryptography to protect your assets."
        keywords="Create QRL Account, New Wallet, Quantum Resistant Account, Post-Quantum Cryptography"
      />
      <div className="flex w-full items-start justify-center pt-16">
        <div className="relative w-full max-w-2xl px-4">
          <img
            className="fixed left-0 top-0 z-0 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-30"
            src="/tree.svg"
            alt="Background Tree"
          />
          <div className="relative z-10">
            {hasAccountCreated ? (
              hasMnemonicNoted ? (
                <AccountCreationSuccess 
                  account={account} 
                  userPassword={userPassword} 
                  mnemonic={mnemonic}
                  hexSeed={hexSeed}
                />
              ) : (
                <MnemonicDisplay
                  account={account}
                  userPassword={userPassword}
                  onMnemonicNoted={onMnemonicNoted}
                />
              )
            ) : (
              <AccountCreationForm onAccountCreated={onAccountCreated} />
            )}
          </div>
        </div>
      </div>
    </>
  );
});

export default CreateAccount;
