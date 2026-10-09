import { Card } from "@/components/UI/Card";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { lazy, useState } from "react";
import { withSuspense } from "@/utils/react";
import { SEO } from "../../../SEO/SEO";
import { useStore } from "../../../../stores/store";
import type { Web3BaseWalletAccount } from "@theqrl/web3";
import { observer } from "mobx-react-lite";
import { AccountCreationForm } from "./AccountCreationForm/AccountCreationForm";
import { useWalletLimit } from "@/hooks/useWalletLimit";
import { AlertCircle } from "lucide-react";
import { Link } from "react-router";
import { ROUTES } from "@/router/router";
import { Button } from "@/components/UI/Button";

const MnemonicDisplay = withSuspense(
  lazy(() => import("./MnemonicDisplay/MnemonicDisplay")),
);

const CreateAccount = observer(() => {
  const { qrlStore } = useStore();
  const { setActiveAccount, qrlConnection } = qrlStore;

  const [account, setAccount] = useState<Web3BaseWalletAccount>();
  const [hasAccountCreated, setHasAccountCreated] = useState(false);
  const [userPassword, setUserPassword] = useState<string>("");
  // Desktop only: the signer-returned address + mnemonic for the backup screen.
  // The hex seed is never returned to the renderer.
  const [desktopBackup, setDesktopBackup] = useState<{
    address: string;
    mnemonic: string;
  }>();

  const { isWalletLimitReached, walletCount, maxWallets } = useWalletLimit(
    qrlConnection.blockchain,
  );

  // Called after account is created AND seed is encrypted/stored (web/native),
  // or after the signer provisioned the wallet (desktop: backup carries the
  // address + one-time mnemonic, account is undefined).
  const onAccountCreated = async (
    newAccount: Web3BaseWalletAccount | undefined,
    password: string,
    backup?: { address: string; mnemonic: string },
  ) => {
    const address = newAccount?.address ?? backup?.address;
    if (address) {
      window.scrollTo(0, 0);
      setAccount(newAccount);
      setDesktopBackup(backup);
      setUserPassword(password);
      await setActiveAccount(address);
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
      <PageShell
        title={
          isWalletLimitReached
            ? "Wallet Limit Reached"
            : hasAccountCreated
              ? "Your Recovery Information"
              : "Create new account"
        }
      >
        <div className="relative z-10">
          {isWalletLimitReached ? (
            <Card className="flex flex-col items-center gap-6 p-6 text-center">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground">
                  You have reached the maximum limit of {maxWallets} wallets.
                  Please remove an existing wallet before creating a new one.
                </p>
                <p className="text-sm text-muted-foreground">
                  Current wallets: {walletCount} / {maxWallets}
                </p>
              </div>
              <Link to={ROUTES.ACCOUNT_LIST}>
                <Button variant="outline">Manage Wallets</Button>
              </Link>
            </Card>
          ) : hasAccountCreated ? (
            <MnemonicDisplay
              account={account}
              userPassword={userPassword}
              desktopBackup={desktopBackup}
            />
          ) : (
            <AccountCreationForm onAccountCreated={onAccountCreated} />
          )}
        </div>
      </PageShell>
    </>
  );
});

export default CreateAccount;
