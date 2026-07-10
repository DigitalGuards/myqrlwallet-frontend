import { ActiveAccount } from "./ActiveAccount/ActiveAccount";
import { OtherAccounts } from "./OtherAccounts/OtherAccounts";
import { SEO } from "../../../SEO/SEO";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { lazy } from "react";
import { withSuspense } from "@/utils/react";
import { useWalletLimit } from "@/hooks/useWalletLimit";
import { Button } from "@/components/UI/Button";
import { Plus } from "lucide-react";

const AccountCreateImport = withSuspense(
  lazy(() => import("../Home/AccountCreateImport/AccountCreateImport"))
);

const AccountList = observer(() => {
  const { qrlStore } = useStore();
  const { activeAccount, qrlConnection } = qrlStore;
  const { isWalletLimitReached, walletCount, maxWallets } = useWalletLimit(
    qrlConnection.blockchain
  );

  // Check if there is an active account
  const noActiveAccount = !activeAccount.accountAddress;

  return (
    <>
      <SEO
        title="Account List"
        description="Manage your QRL accounts securely. View balances, copy addresses, and interact with your quantum-resistant accounts."
        keywords="QRL Accounts, Wallet Management, Account Balance, Quantum Resistant Accounts, QRL Address"
      />
      <div className="flex w-full items-start justify-center py-2 md:py-8 overflow-x-clip">
        <div className="relative w-full max-w-2xl px-2 md:px-4">
          <img
            className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
            src="/tree.svg"
            alt="Background Tree"
          />
          <div className="page-enter flex flex-col gap-4 md:gap-8">
            {noActiveAccount ? (
              <AccountCreateImport />
            ) : (
              <>
                <div className="flex flex-col gap-4">
                  <ActiveAccount />
                  <OtherAccounts />
                </div>
                {isWalletLimitReached ? (
                  <div className="flex flex-col gap-2">
                    <Button className="flex w-full gap-2" disabled>
                      <Plus size={18} /> Wallet limit reached ({walletCount}/{maxWallets})
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      Remove an existing wallet to add a new one
                    </p>
                  </div>
                ) : (
                  <AccountCreateImport />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
});

export default AccountList;
