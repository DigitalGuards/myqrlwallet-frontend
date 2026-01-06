import { Button } from "../../../../UI/Button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../../UI/Card";
import { ROUTES } from "../../../../../router/router";
import { useStore } from "../../../../../stores/store";
import { cva } from "class-variance-authority";
import { Download, Plus, Link2 } from "lucide-react";
import { observer } from "mobx-react-lite";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { connectToExtension } from "@/utils/extension";
import { isInNativeApp } from "@/utils/nativeApp";

const accountCreateImportClasses = cva("flex gap-8", {
  variants: {
    hasAccountCreationPreference: {
      true: ["flex-col-reverse"],
      false: ["flex-col"],
    },
  },
  defaultVariants: {
    hasAccountCreationPreference: false,
  },
});

const AccountCreateImport = observer(() => {
  const { state } = useLocation();
  const { zondStore } = useStore();
  const { activeAccount, setActiveAccount, setExtensionProvider } = zondStore;
  const { accountAddress } = activeAccount;
  const navigate = useNavigate();

  const hasActiveAccount = !!accountAddress;
  const hasAccountCreationPreference = !!state?.hasAccountCreationPreference;

  const handleConnectExtension = async () => {
    const accounts = await connectToExtension(setActiveAccount, setExtensionProvider);
    if (accounts && accounts.length > 0) {
      console.log("Successfully connected via extension, set active account, and stored provider.");
      navigate(ROUTES.HOME);
    } else {
      console.log("Failed to connect via extension or no accounts selected.");
    }
  };

  return (
    <div
      className={accountCreateImportClasses({ hasAccountCreationPreference })}
    >
      <Card className="w-full border-l-4 border-l-secondary">
        <CardHeader className="bg-gradient-to-r from-secondary/5 to-transparent">
          <CardTitle className="text-2xl font-bold">
            {hasActiveAccount ? "Add accounts" : "Let's start"}
          </CardTitle>
          <CardDescription>
            You are connected to the blockchain. Create a new account{isInNativeApp() ? " or " : ", "}import
            an existing account{!isInNativeApp() && ", or connect using your browser extension"}.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex-col gap-4">
          <Link className="w-full" to={ROUTES.CREATE_ACCOUNT}>
            <Button className="w-full" type="button">
              <Plus className="mr-2 h-4 w-4" />
              Create a new account
            </Button>
          </Link>
          <Link className="w-full" to={ROUTES.IMPORT_ACCOUNT}>
            <Button className="w-full" type="button">
              <Download className="mr-2 h-4 w-4" />
              Import an existing account
            </Button>
          </Link>
          {!isInNativeApp() && (
            <Button className="w-full" type="button" variant="outline" onClick={handleConnectExtension}>
              <Link2 className="mr-2 h-4 w-4" />
              Connect Browser Extension
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
});

export default AccountCreateImport;
