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
        <Sidebar className="h-[calc(100vh-2.5rem)] border-r-secondary !border-r">
            <SidebarContent>
                {/* px-0 so the active item is full-bleed: its orange right
                    edge sits flush with the rail border instead of floating
                    inset as a second parallel line. */}
                <SidebarGroup className="px-0">
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
                                        onClick={() => navigateTo(item.url, navigate)}
                                        // Semantic <button> (no asChild) for native keyboard support.
                                        // Override shadcn's rounded-md so the active accent reads as a
                                        // flat full-bleed block with a straight orange edge; keep a
                                        // keyboard-only inset focus ring (mouse clicks don't show it).
                                        className={cn(
                                            "flex flex-col justify-evenly items-center gap-1 py-2 h-auto rounded-none border-r-2 border-r-transparent transition-colors [&>svg]:!size-8",
                                            "hover:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-secondary",
                                            active
                                                ? "bg-secondary/10 border-r-secondary text-foreground"
                                                : "text-muted-foreground hover:text-foreground",
                                        )}
                                    >
                                        <item.icon className="size-8" />
                                        <span className="block text-xs font-medium">{item.label}</span>
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
