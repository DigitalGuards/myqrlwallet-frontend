import { LogOut, Lock, Wallet, ArrowRight, Settings as SettingsIcon } from "lucide-react"

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
import { isDesktop, desktopSigner } from "@/desktop/bridge";
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
        icon: ArrowRight,
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
    // Desktop: there is no "logout" (the seed lives in the signer, not here).
    // The footer button locks the signer session instead; main then shows the
    // native unlock window. Removing the wallet entirely is a separate,
    // confirmed action under Settings.
    const onLockClick = () => {
        void desktopSigner.lock();
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
            {/* Native app hides this entirely (wallet removal lives in native
                settings). Desktop shows Lock (not Logout): the seed stays in the
                signer and locking surfaces the native unlock window. Web keeps
                the seed-wiping Logout. */}
            {!isInNativeApp() && (
                <SidebarFooter>
                    <SidebarMenu>
                        <SidebarMenuItem className="py-2">
                            <SidebarMenuButton
                                asChild
                                className="py-2 h-auto"
                                onClick={isDesktop ? onLockClick : onLogoutClick}
                                tooltip={{ side: "right", children: isDesktop ? "Lock wallet" : "Log out of wallet" }}
                            >
                                <div className="flex flex-col justify-evenly items-center cursor-pointer [&>svg]:!size-8 text-muted-foreground hover:text-foreground">
                                    {isDesktop ? <Lock /> : <LogOut />}
                                    <span className="block text-xs font-medium">{isDesktop ? "Lock" : "Logout"}</span>
                                </div>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarFooter>
            )}
        </Sidebar>
    )
}
