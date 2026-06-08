import { LogOut, Wallet, SendHorizontal, Settings as SettingsIcon, Plus } from "lucide-react"

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    // SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/UI/sidebar"
import { useNavigate, useLocation } from "react-router-dom";
import { ROUTES } from "@/router/router";
import MyQRLWalletLogo from "../Header/MyQRLWalletLogo/MyQRLWalletLogo";
import { handleLogout } from "@/utils/logout";
import { isInNativeApp } from "@/utils/nativeApp";
import { navigateTo } from "@/utils/navigation";
import { cn } from "@/utils/cn";

// Menu items.
const sidebarItems = [
    {
        title: "Account List",
        url: ROUTES.ACCOUNT_LIST,
        label: "Wallets",
        icon: Wallet,
    },
    {
        title: "Send",
        url: ROUTES.TRANSFER,
        label: "Send",
        icon: SendHorizontal,
    },
    {
        title: "Create Token",
        url: ROUTES.CREATE_TOKEN,
        label: "QRC20",
        icon: Plus,
    },
    {
        title: "Settings",
        url: ROUTES.SETTINGS,
        label: "Settings",
        icon: SettingsIcon,
    },
]

export function AppSidebar() {
    const navigate = useNavigate();
    const location = useLocation();
    const onLogoutClick = () => {
        handleLogout(navigate);
    };
    const isActive = (url: string) =>
        location.pathname === url || location.pathname.startsWith(`${url}/`);

    return (
        <Sidebar className="h-[calc(100vh-2.5rem)] border-r-secondary">
            <SidebarContent>
                <SidebarGroup>
                    {/* <SidebarGroupLabel>Application</SidebarGroupLabel> */}
                    <SidebarGroupContent className="mt-5">
                        <SidebarMenu>
                            <SidebarMenuItem className="cursor-pointer flex justify-center py-5" onClick={() => navigate(ROUTES.HOME)}>
                                <MyQRLWalletLogo showText={false} size="lg" />
                            </SidebarMenuItem>
                            {sidebarItems.map((item) => {
                                const active = isActive(item.url);
                                return (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton
                                        asChild
                                        onClick={() => navigateTo(item.url, navigate)}
                                        // Override shadcn's rounded-md + focus ring so the active
                                        // accent reads as a flat full-bleed block with a straight
                                        // orange edge (rounded right-border renders as a curve).
                                        className={cn(
                                            "py-2 h-auto rounded-none border-r-2 border-r-transparent transition-colors",
                                            "hover:bg-transparent focus-visible:ring-0",
                                            active && "bg-secondary/10 border-r-secondary",
                                        )}
                                    >
                                        <div
                                            className={cn(
                                                "flex flex-col justify-evenly items-center cursor-pointer [&>svg]:!size-8",
                                                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                                            )}
                                        >
                                            <item.icon className="size-8" />
                                            <span className="block text-xs font-medium">{item.label}</span>
                                        </div>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                                );
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            {/* Hide logout button when running in native app - wallet removal is handled in native settings */}
            {!isInNativeApp() && (
                <SidebarFooter>
                    <SidebarMenu>
                        <SidebarMenuItem className="py-2">
                            <SidebarMenuButton asChild className="py-2 h-auto" onClick={onLogoutClick} tooltip={{ side: "right", children: "Log out of wallet" }}>
                                <div className="flex flex-col justify-evenly items-center cursor-pointer [&>svg]:!size-8 text-muted-foreground hover:text-foreground">
                                    <LogOut />
                                    <span className="block text-xs font-medium">Logout</span>
                                </div>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarFooter>
            )}
        </Sidebar>
    )
}
