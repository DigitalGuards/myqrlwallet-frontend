import { ActiveAccount } from "./ActiveAccount/ActiveAccount";
import { NewAccount } from "./NewAccount/NewAccount";
import { OtherAccounts } from "./OtherAccounts/OtherAccounts";
import { SEO } from "../../../SEO/SEO";

const AccountList = () => {
  return (
    <>
      <SEO
        title="Account List"
        description="Manage your QRL accounts securely. View balances, copy addresses, and interact with your quantum-resistant accounts."
        keywords="QRL Accounts, Wallet Management, Account Balance, Quantum Resistant Accounts, QRL Address"
      />
      <div className="flex flex-col gap-8 p-8">
        <NewAccount />
        <div className="flex flex-col gap-4">
          <ActiveAccount />
          <OtherAccounts />
        </div>
      </div>
    </>
  );
};

export default AccountList;
