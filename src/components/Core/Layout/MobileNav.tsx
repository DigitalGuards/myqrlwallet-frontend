import { useTranslation } from "react-i18next";
import {
  Wallet,
  ArrowRight,
  Settings as SettingsIcon,
  LogOut,
  BookUser,
} from "lucide-react";
import { useNavigate, useLocation } from "react-router";
import { ROUTES } from "@/router/router";
import { handleLogout } from "@/utils/logout";
import { isInNativeApp } from "@/utils/nativeApp";
import { navigateTo } from "@/utils/navigation";
import { cn } from "@/utils/cn";
import { logger } from "@/utils/log";

const navItems = [
  {
    icon: ArrowRight,
    labelKey: "send",
    path: ROUTES.TRANSFER,
  },
  {
    icon: Wallet,
    labelKey: "wallets",
    path: ROUTES.ACCOUNT_LIST,
  },
  {
    icon: BookUser,
    labelKey: "contacts",
    path: ROUTES.ADDRESS_BOOK,
  },
  {
    icon: SettingsIcon,
    labelKey: "settings",
    path: ROUTES.SETTINGS,
  },
] as const;

export default function MobileNav() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const location = useLocation();

  const onLogoutClick = () => {
    void handleLogout((path) => {
      void Promise.resolve(navigate(path)).catch((error: unknown) => {
        logger.error("Failed to navigate after logout:", error);
      });
    }).catch((error: unknown) => {
      logger.error("Error during logout:", error);
    });
  };

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <nav className="md:hidden fixed bottom-0 border-t border-t-foreground/10 bg-background/85 backdrop-blur-lg w-full z-10 min-h-16 grid grid-flow-col auto-cols-fr items-stretch gap-1 px-1">
      {navItems.map((item) => {
        const active = isActive(item.path);
        return (
          <button
            key={item.path}
            aria-current={active ? "page" : undefined}
            className={cn(
              "cursor-pointer relative flex min-w-0 flex-col justify-center items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
              active
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              navigateTo(item.path, navigate);
            }}
          >
            {/* Sky-blue tick above the active tab, mirroring the desktop rail edge */}
            <span
              aria-hidden
              className={cn(
                "absolute -top-[13px] h-0.5 w-8 rounded-full bg-primary shadow-[0_0_8px_hsl(199_78%_55%/0.8)] transition-opacity",
                active ? "opacity-100" : "opacity-0",
              )}
            />
            <item.icon className="h-5 w-5" />
            <span className="max-w-full break-words text-center leading-tight">
              {t(item.labelKey)}
            </span>
          </button>
        );
      })}
      {/* Hide logout button when running in native app - wallet removal is handled in native settings */}
      {!isInNativeApp() && (
        <button
          className="cursor-pointer flex min-w-0 flex-col justify-center items-center gap-0.5 py-2 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={onLogoutClick}
        >
          <LogOut className="h-5 w-5" />
          <span>{t("logout")}</span>
        </button>
      )}
    </nav>
  );
}
