import { lazy, useState } from "react";
import { withSuspense } from "@/utils/react";
import { SEO } from "../../../SEO/SEO";
import { useStore } from "../../../../stores/store";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import { observer } from "mobx-react-lite";
import { AccountCreationForm } from "./AccountCreationForm/AccountCreationForm";
import { useWalletLimit } from "@/hooks/useWalletLimit";
import { AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { ROUTES } from "@/router/router";
import { Button } from "@/components/UI/Button";

const MnemonicDisplay = withSuspense(
  lazy(() => import("./MnemonicDisplay/MnemonicDisplay"))
);

const CreateAccount = observer(() => {
  const { zondStore } = useStore();
  const { setActiveAccount, zondConnection } = zondStore;

  const [account, setAccount] = useState<Web3BaseWalletAccount>();
  const [hasAccountCreated, setHasAccountCreated] = useState(false);
  const [userPassword, setUserPassword] = useState<string>("");

  const { isWalletLimitReached, walletCount, maxWallets } = useWalletLimit(zondConnection.blockchain);

  // Called after account is created AND seed is encrypted/stored
  const onAccountCreated = async (
    newAccount: Web3BaseWalletAccount,
    password: string,
  ) => {
    if (newAccount?.address) {
      window.scrollTo(0, 0);
      setAccount(newAccount);
      setUserPassword(password);
      await setActiveAccount(newAccount.address);
      setHasAccountCreated(true);
    }
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
            {isWalletLimitReached ? (
              <div className="flex flex-col items-center gap-6 rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
                <AlertCircle className="h-12 w-12 text-destructive" />
                <div className="flex flex-col gap-2">
                  <h2 className="text-xl font-semibold text-foreground">
                    Wallet Limit Reached
                  </h2>
                  <p className="text-muted-foreground">
                    You have reached the maximum limit of {maxWallets} wallets.
                    Please remove an existing wallet before creating a new one.
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
            ) : hasAccountCreated ? (
              <MnemonicDisplay
                account={account}
                userPassword={userPassword}
              />
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
