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

const wallets: string[] = [
    "0x10b4fb2929cfBe8b002b8A0c572551F755e54aEF",
    "0x20b4fb2929cfBe8b002b8A0c572551F755e54aEF",
    "0x30b4fb2929cfBe8b002b8A0c572551F755e54aEF",
    "0x40b4fb2929cfBe8b002b8A0c572551F755e54aEF",
]

const NavBar = observer(() => {
    const { zondStore } = useStore();
    const {
        setActiveAccount,
    } = zondStore;

    return (
        <NavigationMenu>
            <NavigationMenuList>
                <NavigationMenuItem>
                    <NavigationMenuTrigger>Wallets</NavigationMenuTrigger>
                    <NavigationMenuContent>
                        <ul className="flex flex-col gap-1 p-4 w-full">
                            {wallets.map((wallet, idx) => (
                                <span key={idx} className="cursor-pointer hover:bg-gray-900 p-1 rounded" onClick={() => setActiveAccount(wallet)}>
                                    {wallet}
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
                    <Link to={"/send-token"}>
                        <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                            Send Token
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
