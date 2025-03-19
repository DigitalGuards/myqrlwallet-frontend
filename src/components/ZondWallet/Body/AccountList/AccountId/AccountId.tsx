import { observer } from "mobx-react-lite";
import { cn } from "@/lib/utils";

type AccountIdType = {
  account: string;
  className?: string;
  oneLine?: boolean;
};

export const AccountId = observer(({ account, className, oneLine = false }: AccountIdType) => {
  const splitLength = 5;
  const prefix = account.substring(0, 1);
  const idSplit: string[] = [];
  for (let i = 1; i < account.length; i += splitLength) {
    idSplit.push(account.substring(i, i + splitLength));
  }

  if (oneLine) {
    return (
      <div className={cn("flex gap-2", className)}>
        <div>{prefix}</div>
        <div>{account.substring(1, 5)}</div>
        <div>{account.substring(5, 9)}</div>
        <div>...</div>
        <div>{account.substring(account.length - 8, account.length - 4)}</div>
        <div>{account.substring(account.length - 4)}</div>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-2", className)}>
      <div>{prefix}</div>
      <div className={cn("flex flex-wrap gap-1")}>
        {idSplit.map((part) => (
          <div key={part}>{part}</div>
        ))}
      </div>
    </div>
  );
});
