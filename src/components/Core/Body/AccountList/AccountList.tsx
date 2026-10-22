import { accountSetupDescription } from "../Home/AccountCreateImport/accountSetupDescription";
import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/Core/Layout/PageShell";
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
  lazy(() => import("../Home/AccountCreateImport/AccountCreateImport")),
);

const AccountList = observer(() => {
  const { t } = useTranslation(["accounts", "home", "common"]);
  const { qrlStore } = useStore();
  const { activeAccount, qrlConnection } = qrlStore;
  const { isWalletLimitReached, walletCount, maxWallets } = useWalletLimit(
    qrlConnection.blockchain,
  );

  // Check if there is an active account
  const noActiveAccount = !activeAccount.accountAddress;

  return (
    <>
      <SEO
        title={t("accounts:seoTitle")}
        description={t("accounts:seoDescription")}
        keywords={t("accounts:seoKeywords")}
      />
      <PageShell
        title={noActiveAccount ? t("accounts:start") : t("accounts:title")}
        subtitle={noActiveAccount ? t(accountSetupDescription()) : undefined}
      >
        <div className="flex flex-col gap-4 md:gap-8">
          {noActiveAccount ? (
            <AccountCreateImport showHeading={false} />
          ) : (
            <>
              <div className="flex flex-col gap-4">
                <ActiveAccount />
                <OtherAccounts />
              </div>
              {isWalletLimitReached ? (
                <div className="flex flex-col gap-2">
                  <Button className="flex w-full gap-2" disabled>
                    <Plus size={18} /> {t("accounts:limit", { count: walletCount, max: maxWallets })}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    {t("accounts:removeToAdd")}
                  </p>
                </div>
              ) : (
                <AccountCreateImport />
              )}
            </>
          )}
        </div>
      </PageShell>
    </>
  );
});

export default AccountList;
