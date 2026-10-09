import { accountSetupDescription } from "../Home/AccountCreateImport/accountSetupDescription";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { observer } from "mobx-react-lite";
import { lazy } from "react";
import { withSuspense } from "@/utils/react";

const AccountCreateImport = withSuspense(
  lazy(() => import("../Home/AccountCreateImport/AccountCreateImport")),
);

const AddAccount = observer(() => {
  return (
    <PageShell
      title="Add accounts"
      subtitle={accountSetupDescription()}
      seoTitle="Add Account"
    >
      <div className="relative z-10">
        <AccountCreateImport showHeading={false} />
      </div>
    </PageShell>
  );
});

export default AddAccount;
