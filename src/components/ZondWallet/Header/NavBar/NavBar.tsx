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
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "@/stores/store";

const NavBar = observer(() => {
    const navigate = useNavigate();
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
                                <span className="flex w-full min-w-[250px] justify-center py-2 bg-gray-800 cursor-pointer hover:bg-gray-900 m-auto rounded">
                                    + Create or import an account
                                </span>
                            </Link>
                        </ul>
                    </NavigationMenuContent>
                </NavigationMenuItem>
                <NavigationMenuItem className="cursor-pointer">
                    <NavigationMenuLink onClick={() => navigate("/create-token")} className={navigationMenuTriggerStyle()}>
                        Create Token
                    </NavigationMenuLink>
                </NavigationMenuItem>
                <NavigationMenuItem className="cursor-pointer">
                    <NavigationMenuLink onClick={() => navigate("/tokens")} className={navigationMenuTriggerStyle()}>
                        Tokens
                    </NavigationMenuLink>
                </NavigationMenuItem>
                <NavigationMenuItem className="cursor-pointer">
                    <NavigationMenuLink onClick={() => navigate("")} className={navigationMenuTriggerStyle()}>
                        Settings
                    </NavigationMenuLink>
                </NavigationMenuItem>
            </NavigationMenuList>
        </NavigationMenu>
    )
});

export default NavBar;
