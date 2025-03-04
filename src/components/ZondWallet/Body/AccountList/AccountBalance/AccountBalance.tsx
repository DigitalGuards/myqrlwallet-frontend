import { useStore } from "../../../../../stores/store";
import { observer } from "mobx-react-lite";
import { formatBalance } from "@/utilities/helper";

type AccountBalanceProps = {
  accountAddress: string;
};

export const AccountBalance = observer(({ accountAddress }: AccountBalanceProps) => {
  const { zondStore } = useStore();
  const { getAccountBalance } = zondStore;
  const balance = getAccountBalance(accountAddress);

  return (
    <div className="text-sm text-secondary">
      Balance: {formatBalance(balance)}
    </div>
  );
});
