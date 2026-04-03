import { Button } from "../../../../UI/Button";
import { ROUTES } from "../../../../../router/router";
import { Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useState, useEffect } from "react";
import { StorageUtil } from "@/utils/storage";

export const NewAccount = observer(() => {
  const { qrlStore } = useStore();
  const { qrlConnection } = qrlStore;

  const [isLimitReached, setIsLimitReached] = useState(false);
  const [walletCount, setWalletCount] = useState(0);
  const maxWallets = StorageUtil.getMaxWallets();

  useEffect(() => {
    const checkLimit = async () => {
      if (qrlConnection.blockchain) {
        const limitReached = await StorageUtil.isWalletLimitReached(qrlConnection.blockchain);
        const count = await StorageUtil.getWalletCount(qrlConnection.blockchain);
        setIsLimitReached(limitReached);
        setWalletCount(count);
      }
    };
    checkLimit();
  }, [qrlConnection.blockchain]);

  if (isLimitReached) {
    return (
      <div className="flex flex-col gap-2">
        <Button className="flex w-full gap-2" disabled>
          <Plus size={18} /> Wallet limit reached ({walletCount}/{maxWallets})
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Remove an existing wallet to add a new one
        </p>
      </div>
    );
  }

  return (
    <Link to={ROUTES.HOME} state={{ hasAccountCreationPreference: true }}>
      <Button className="flex w-full gap-2">
        <Plus size={18} /> Create or import an account
      </Button>
    </Link>
  );
});
