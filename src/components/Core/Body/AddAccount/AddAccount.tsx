import { accountSetupDescription } from "../Home/AccountCreateImport/accountSetupDescription";
import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { RouteBack } from "@/components/Core/Layout/PageBack";
import { ROUTES } from "@/router/routes";
import { observer } from "mobx-react-lite";
import { lazy } from "react";
import { withSuspense } from "@/utils/react";

const AccountCreateImport = withSuspense(
  lazy(() => import("../Home/AccountCreateImport/AccountCreateImport")),
);

const AddAccount = observer(() => {
  const { t } = useTranslation(["onboarding", "home", "common"]);
  return (
    <PageShell
      title={t("onboarding:addAccounts")}
      subtitle={t(accountSetupDescription())}
      seoTitle={t("onboarding:addTitle")}
      back={<RouteBack route={ROUTES.ADD_ACCOUNT} />}
    >
      <div className="relative z-10">
        <AccountCreateImport showHeading={false} />
      </div>
    </PageShell>
  );
});

export default AddAccount;
