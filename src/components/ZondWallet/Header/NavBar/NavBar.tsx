import { useState } from "react";
import { observer } from "mobx-react-lite";
import { Menu, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "@/stores/store";

import {
    NavigationMenu,
    NavigationMenuContent,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
    NavigationMenuTrigger,
    navigationMenuTriggerStyle,
} from "../../../UI/NavigationMenu";

import { Button } from "@/components/UI/Button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/UI/sheet";
import { DialogHeader } from "@/components/UI/Dialog";
import { DialogTitle } from "@/components/UI/Dialog";

const NavBar = observer(() => {
    const navigate = useNavigate();
    const { zondStore } = useStore();
    const { zondAccounts, setActiveAccount } = zondStore;

    const [open, setOpen] = useState(false);

    const switchAccount = (accountAddress: string) => {
        setActiveAccount(accountAddress);
        setOpen(false); // Close mobile menu on selection
    };

    return (
        <nav className="flex items-center justify-between p-4 border-b">
            {/* Logo */}
            {/* Desktop Menu */}
            <NavigationMenu className="hidden md:flex">
                <NavigationMenuList>
                    <NavigationMenuItem>
                        <NavigationMenuTrigger>Wallets</NavigationMenuTrigger>
                        <NavigationMenuContent>
                            <ul className="flex flex-col gap-1 p-4 w-full">
                                {zondAccounts.accounts.map((account, idx) => (
                                    <span
                                        key={idx}
                                        className="cursor-pointer font-mono hover:bg-gray-900 p-1 rounded"
                                        onClick={() => switchAccount(account.accountAddress)}
                                    >
                                        {account.accountAddress.substring(0, 15)}...
                                        {account.accountAddress.substring(account.accountAddress.length - 12)}
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
                    <NavigationMenuItem>
                        <NavigationMenuLink onClick={() => navigate("/create-token")} className={navigationMenuTriggerStyle()}>
                            Create Token
                        </NavigationMenuLink>
                    </NavigationMenuItem>
                    <NavigationMenuItem>
                        <NavigationMenuLink onClick={() => navigate("/tokens")} className={navigationMenuTriggerStyle()}>
                            Tokens
                        </NavigationMenuLink>
                    </NavigationMenuItem>
                    <NavigationMenuItem>
                        <NavigationMenuLink onClick={() => navigate("")} className={navigationMenuTriggerStyle()}>
                            Settings
                        </NavigationMenuLink>
                    </NavigationMenuItem>
                </NavigationMenuList>
            </NavigationMenu>

            {/* Mobile Hamburger Menu */}
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="md:hidden"
                        onClick={() => setOpen(true)}
                    >
                        {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                    </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64 p-4 h">
                    <DialogHeader className="items-start">
                        <DialogTitle>Menu</DialogTitle>
                    </DialogHeader>
                    <NavigationMenu>
                        <NavigationMenuList className="flex flex-col space-y-4 mt-6 items-start">
                            <NavigationMenuItem className="w-full">
                                <NavigationMenuLink
                                    onClick={() => {
                                        navigate("/create-token");
                                        setOpen(false);
                                    }}
                                    className={navigationMenuTriggerStyle()}
                                >
                                    Create Token
                                </NavigationMenuLink>
                            </NavigationMenuItem>
                            <NavigationMenuItem>
                                <NavigationMenuLink
                                    onClick={() => {
                                        navigate("/tokens");
                                        setOpen(false);
                                    }}
                                    className={navigationMenuTriggerStyle()}
                                >
                                    Tokens
                                </NavigationMenuLink>
                            </NavigationMenuItem>
                            <NavigationMenuItem>
                                <NavigationMenuLink
                                    onClick={() => {
                                        navigate("");
                                        setOpen(false);
                                    }}
                                    className={navigationMenuTriggerStyle()}
                                >
                                    Settings
                                </NavigationMenuLink>
                            </NavigationMenuItem>
                            <NavigationMenuItem>
                                <NavigationMenuTrigger>Wallets</NavigationMenuTrigger>
                                <NavigationMenuContent>
                                    <ul className="flex flex-col gap-1 p-4 w-full">
                                        {zondAccounts.accounts.map((account, idx) => (
                                            <span
                                                key={idx}
                                                className="cursor-pointer font-mono hover:bg-gray-900 p-1 rounded"
                                                onClick={() => switchAccount(account.accountAddress)}
                                            >
                                                {account.accountAddress.substring(0, 15)}...
                                                {account.accountAddress.substring(account.accountAddress.length - 12)}
                                            </span>
                                        ))}
                                        <Link to={"/add-account"} onClick={() => setOpen(false)}>
                                            <span className="flex w-full min-w-[250px] justify-center py-2 bg-gray-800 cursor-pointer hover:bg-gray-900 m-auto rounded">
                                                + Create or import an account
                                            </span>
                                        </Link>
                                    </ul>
                                </NavigationMenuContent>
                            </NavigationMenuItem>
                        </NavigationMenuList>
                    </NavigationMenu>
                </SheetContent>
            </Sheet>
        </nav>
    );
});

export default NavBar;
