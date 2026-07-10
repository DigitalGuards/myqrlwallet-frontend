import { Wallet, ArrowRight, Settings as SettingsIcon, LogOut, BookUser } from "lucide-react"
import { useNavigate, useLocation } from "react-router-dom";
import { ROUTES } from "@/router/router";
import { handleLogout } from "@/utils/logout";
import { isInNativeApp } from "@/utils/nativeApp";
import { navigateTo } from "@/utils/navigation";
import { cn } from "@/utils/cn";

const navItems = [
    {
        icon: ArrowRight,
        label: "Send",
        path: ROUTES.TRANSFER,
    },
    {
        icon: Wallet,
        label: "Wallets",
        path: ROUTES.ACCOUNT_LIST,
    },
    {
        icon: BookUser,
        label: "Contacts",
        path: ROUTES.ADDRESS_BOOK,
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
        <nav className="md:hidden fixed bottom-0 border-t border-t-foreground/10 bg-background/85 backdrop-blur-lg w-full z-10 h-14 flex items-center justify-around px-4">
            {
                navItems.map((item) => {
                    const active = isActive(item.path);
                    return (
                        <button
                            key={item.path}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                                "cursor-pointer relative flex flex-col items-center gap-0.5 text-xs font-medium transition-colors",
                                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                            )}
                            onClick={() => navigateTo(item.path, navigate)}
                        >
                            {/* Ember tick above the active tab, mirroring the desktop rail edge */}
                            <span
                                aria-hidden
                                className={cn(
                                    "absolute -top-[13px] h-0.5 w-8 rounded-full bg-primary shadow-[0_0_8px_hsl(24_96%_55%/0.8)] transition-opacity",
                                    active ? "opacity-100" : "opacity-0",
                                )}
                            />
                            <item.icon className="h-5 w-5" />
                            <span>{item.label}</span>
                        </button>
                    );
                })
            }
            {/* Hide logout button when running in native app - wallet removal is handled in native settings */}
            {!isInNativeApp() && (
                <button className="cursor-pointer flex flex-col items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={onLogoutClick}>
                    <LogOut className="h-5 w-5" />
                    <span>Logout</span>
                </button>
            )}
        </nav>
    )
}
