import { LogOut, Users, SendHorizontal, QrCode, Settings as SettingsIcon } from "lucide-react"

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
// Menu items.
const sidebarItems = [
    {
        title: "Account List",
        url: ROUTES.ACCOUNT_LIST,
        icon: Users,
    },
    {
        title: "Send",
        url: ROUTES.SEND,
        icon: SendHorizontal,
    },
    {
        title: "QR View",
        url: ROUTES.QR_VIEW,
        icon: QrCode,
    },
    {
        title: "Settings",
        url: ROUTES.SETTINGS,
        icon: SettingsIcon,
    },
]

export function AppSidebar() {
    const navigate = useNavigate();
    return (
        <Sidebar className="h-[calc(100vh-2.5rem)] border-r-secondary">
            <SidebarContent>
                <SidebarGroup>
                    {/* <SidebarGroupLabel>Application</SidebarGroupLabel> */}
                    <SidebarGroupContent className="mt-10">
                        <SidebarMenu>
                            {sidebarItems.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton asChild className="py-8">
                                        <a onClick={() => navigate(item.url)} className="cursor-pointer flex gap-5 justify-around [&>svg]:!size-8">
                                            <item.icon />
                                            {/* <span>{item.title}</span> */}
                                        </a>
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
                        <SidebarMenuButton className="[&>svg]:!size-8 mb-5 justify-around py-8">
                            <LogOut />
                            {/* <span>Logout</span> */}
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>
    )
}
