import { observer } from "mobx-react-lite";
import { cn } from "@/utils/cn";
import { QrlAddress } from "@/components/UI/QrlAddress";

type AccountIdType = {
  account: string;
  className?: string;
  oneLine?: boolean;
};

export const AccountId = observer(
  ({ account, className, oneLine = false }: AccountIdType) => {
    return (
      <QrlAddress
        address={account}
        revealable={!oneLine}
        className={cn("w-full", className)}
        addressClassName="text-center md:text-left"
      />
    );
  },
);
