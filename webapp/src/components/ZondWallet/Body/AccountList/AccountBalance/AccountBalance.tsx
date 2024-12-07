import { useStore } from "../../../../../stores/store";
import { observer } from "mobx-react-lite";

type AccountBalanceProps = {
  accountAddress: string;
};

export const AccountBalance = observer(({ accountAddress }: AccountBalanceProps) => {
  const { zondStore } = useStore();
  const { getAccountBalance } = zondStore;
  const balance = getAccountBalance(accountAddress);

  return (
    <div className="text-sm text-secondary">
      Balance: {balance}
    </div>
  );
});
