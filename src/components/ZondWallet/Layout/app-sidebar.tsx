import { LogOut, Users, SendHorizontal, Settings as SettingsIcon, Plus } from "lucide-react"

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
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/router/router";
import ZondWalletLogo from "../Header/ZondWalletLogo/ZondWalletLogo";
import { handleLogout } from "@/utilities/logoutUtil";

// Menu items.
const sidebarItems = [
    {
        title: "Account List",
        url: ROUTES.ACCOUNT_LIST,
        label: "Wallets",
        icon: Users,
    },
    {
        title: "Send",
        url: ROUTES.ACCOUNT_DETAILS,
        label: "Send",
        icon: SendHorizontal,
    },
    {
        title: "Create Token",
        url: ROUTES.CREATE_TOKEN,
        label: "ZRC20",
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
    const onLogoutClick = () => {
        handleLogout(navigate);
    };

    return (
        <Sidebar className="h-[calc(100vh-2.5rem)] border-r-secondary">
            <SidebarContent>
                <SidebarGroup>
                    {/* <SidebarGroupLabel>Application</SidebarGroupLabel> */}
                    <SidebarGroupContent className="mt-5">
                        <SidebarMenu>
                            <SidebarMenuItem className="cursor-pointer flex justify-center py-5" onClick={() => navigate(ROUTES.HOME)}>
                                <ZondWalletLogo showText={false} size="lg" />
                            </SidebarMenuItem>
                            {sidebarItems.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton asChild className="py-2 h-auto" onClick={() => navigate(item.url)}>
                                        <div className="flex flex-col justify-evenly items-center cursor-pointer [&>svg]:!size-8 text-muted-foreground hover:text-foreground"
                                        >
                                            <item.icon className="size-8" />
                                            <span className="block text-xs font-medium">{item.label}</span>
                                        </div>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                <SidebarMenu>
                    <SidebarMenuItem className="py-2">
                        <SidebarMenuButton className="[&>svg]:!size-8 mb-5 justify-around py-8" onClick={onLogoutClick}>
                            <LogOut />
                            {/* <span>Logout</span> */}
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>
    )
}
