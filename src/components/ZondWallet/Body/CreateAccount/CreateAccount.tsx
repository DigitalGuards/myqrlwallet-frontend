import { lazy, useState } from "react";
import { withSuspense } from "@/utils/react";
import { SEO } from "../../../SEO/SEO";
import { useStore } from "../../../../stores/store";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { observer } from "mobx-react-lite";
import { AccountCreationForm } from "./AccountCreationForm/AccountCreationForm";
import { AccountCreationSuccess } from "./AccountCreationSuccess/AccountCreationSuccess";
import { WalletEncryptionUtil } from "@/utils/crypto";
import { StorageUtil } from "@/utils/storage";

const MnemonicDisplay = withSuspense(
  lazy(() => import("./MnemonicDisplay/MnemonicDisplay"))
);

const CreateAccount = observer(() => {
  const { zondStore } = useStore();
  const { setActiveAccount, zondConnection } = zondStore;
  const { blockchain } = zondConnection;

  const [account, setAccount] = useState<Web3BaseWalletAccount>();
  const [hasAccountCreated, setHasAccountCreated] = useState(false);
  const [hasMnemonicNoted, setHasMnemonicNoted] = useState(false);
  const [userPassword, setUserPassword] = useState<string>("");
  const [userPin, setUserPin] = useState<string>("");
  const [mnemonic, setMnemonic] = useState<string>("");
  const [hexSeed, setHexSeed] = useState<string>("");

  const onAccountCreated = async (newAccount: Web3BaseWalletAccount, password: string, pin: string) => {
    if (newAccount?.address) {
      window.scrollTo(0, 0);
      setAccount(newAccount);
      setUserPassword(password);
      setUserPin(pin);
      await setActiveAccount(newAccount.address);
      setHasAccountCreated(true);
    }
  };

  const onMnemonicNoted = async (notedMnemonic: string, notedHexSeed: string) => {
    window.scrollTo(0, 0);
    setMnemonic(notedMnemonic);
    setHexSeed(notedHexSeed);
    
    // Store the encrypted seed in localStorage if we have all required data
    if (account?.address && userPin && notedMnemonic && notedHexSeed) {
      try {
        // Encrypt the seed with the PIN
        const encryptedSeed = WalletEncryptionUtil.encryptSeedWithPin(
          notedMnemonic,
          notedHexSeed,
          userPin
        );
        
        // Store the encrypted seed in localStorage
        await StorageUtil.storeEncryptedSeed(
          blockchain,
          account.address,
          encryptedSeed
        );
      } catch (error) {
        console.error("Failed to store encrypted seed:", error);
      }
    }
    
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
            className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
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
