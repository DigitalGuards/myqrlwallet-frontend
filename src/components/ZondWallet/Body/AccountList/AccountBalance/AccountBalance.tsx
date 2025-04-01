import { useStore } from "../../../../../stores/store";
import { observer } from "mobx-react-lite";
import { formatBalance } from "@/utilities/helper";
import { cn } from "@/lib/utils";

type AccountBalanceProps = {
  accountAddress: string;
  className?: string;
};

export const AccountBalance = observer(({ accountAddress, className }: AccountBalanceProps) => {
  const { zondStore } = useStore();
  const { getAccountBalance } = zondStore;
  const balance = getAccountBalance(accountAddress);

  return (
    <div className={cn("text-sm text-secondary", className)}>
      Balance: {formatBalance(balance)} QRL
    </div>
  );
});
