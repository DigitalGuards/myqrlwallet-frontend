import { Wallet, SendHorizontal, Settings as SettingsIcon, Plus, LogOut } from "lucide-react"
import { useNavigate, useLocation } from "react-router-dom";
import { ROUTES } from "@/router/router";
import { handleLogout } from "@/utils/logout";
import { isInNativeApp } from "@/utils/nativeApp";
import { navigateTo } from "@/utils/navigation";
import { cn } from "@/utils/cn";

const navItems = [
    {
        icon: SendHorizontal,
        label: "Send",
        path: ROUTES.TRANSFER,
    },
    {
        icon: Wallet,
        label: "Wallets",
        path: ROUTES.ACCOUNT_LIST,
    },
    {
        icon: Plus,
        label: "QRC20",
        path: ROUTES.CREATE_TOKEN,
    },
    {
        icon: SettingsIcon,
        label: "Settings",
        path: ROUTES.SETTINGS,
    },
]

export default function MobileNav() {
    const navigate = useNavigate();
    const location = useLocation();

    const onLogoutClick = () => {
        handleLogout(navigate);
    };

    const isActive = (path: string) =>
        location.pathname === path || location.pathname.startsWith(`${path}/`);

    return (
        <nav className="md:hidden fixed bottom-0 border-t-2 border-t-secondary/50 bg-background w-full z-10 h-14 flex items-center justify-around px-4">
            {
                navItems.map((item) => {
                    const active = isActive(item.path);
                    return (
                        <button
                            key={item.path}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                                "cursor-pointer flex flex-col items-center text-sm transition-colors",
                                active ? "text-secondary" : "text-muted-foreground hover:text-foreground",
                            )}
                            onClick={() => navigateTo(item.path, navigate)}
                        >
                            <item.icon className="h-5 w-5" />
                            <span>{item.label}</span>
                        </button>
                    );
                })
            }
            {/* Hide logout button when running in native app - wallet removal is handled in native settings */}
            {!isInNativeApp() && (
                <button className="cursor-pointer flex flex-col items-center text-sm text-muted-foreground hover:text-foreground transition-colors" onClick={onLogoutClick}>
                    <LogOut className="h-5 w-5" />
                    <span>Logout</span>
                </button>
            )}
        </nav>
    )
}
