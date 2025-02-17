import { observer } from "mobx-react-lite";

import {
    NavigationMenu,
    NavigationMenuContent,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
    NavigationMenuTrigger,
    navigationMenuTriggerStyle,
} from "../../../UI/NavigationMenu"
import { Link } from "react-router-dom";
import { useStore } from "@/stores/store";

const NavBar = observer(() => {
    const { zondStore } = useStore();
    const {
        zondAccounts,
        setActiveAccount,
    } = zondStore;

    const switchAccount = (accountAddress: string) => {
        setActiveAccount(accountAddress)
    }

    return (
        <NavigationMenu>
            <NavigationMenuList>
                <NavigationMenuItem>
                    <NavigationMenuTrigger>Wallets</NavigationMenuTrigger>
                    <NavigationMenuContent>
                        <ul className="flex flex-col gap-1 p-4 w-full">
                            {zondAccounts.accounts.map((account, idx) => (
                                <span key={idx} className="cursor-pointer font-mono hover:bg-gray-900 p-1 rounded" onClick={() => switchAccount(account.accountAddress)}>
                                    {
                                        account.accountAddress
                                            .substring(0, 15)
                                            .concat("...")
                                            .concat(account.accountAddress.substring(account.accountAddress.length - 12))
                                    }
                                </span>
                            ))}
                            <Link to={"/add-account"}>
                                <span className="flex w-full justify-center py-2 bg-gray-800 cursor-pointer hover:bg-gray-900 m-auto rounded">
                                    + Create or import an account
                                </span>
                            </Link>
                        </ul>
                    </NavigationMenuContent>
                </NavigationMenuItem>
                <NavigationMenuItem>
                    <Link to={"/create-token"}>
                        <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                            Create Token
                        </NavigationMenuLink>
                    </Link>
                </NavigationMenuItem>
                <NavigationMenuItem>
                    <Link to={"/tokens"}>
                        <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                            Tokens
                        </NavigationMenuLink>
                    </Link>
                </NavigationMenuItem>
                <NavigationMenuItem>
                    <Link to={""}>
                        <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                            Settings
                        </NavigationMenuLink>
                    </Link>
                </NavigationMenuItem>
            </NavigationMenuList>
        </NavigationMenu>
    )
});

export default NavBar;
