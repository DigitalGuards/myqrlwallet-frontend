import { observer } from "mobx-react-lite";
import { cn } from "@/utils/cn";
import { formatAddress, formatAddressShort } from "@/utils/formatting";

type AccountIdType = {
  account: string;
  className?: string;
  oneLine?: boolean;
};

export const AccountId = observer(({ account, className, oneLine = false }: AccountIdType) => {
  if (oneLine) {
    return (
      <div className={cn("font-mono", className)}>
        {formatAddressShort(account)}
      </div>
    );
  }

  return (
    <div className={cn("font-mono", className)}>
      {formatAddress(account)}
    </div>
  );
});
