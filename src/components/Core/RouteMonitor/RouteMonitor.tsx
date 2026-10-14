import { ROUTES } from "../../../router/router";
import { useStore } from "../../../stores/store";
import { StorageUtil } from "@/utils/storage";
import { recordRoute } from "@/utils/nativeBack";
import { isDesktop } from "@/desktop/bridge";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { logger } from "@/utils/log";

const RouteMonitor = observer(() => {
  const { qrlStore } = useStore();
  const { qrlConnection } = qrlStore;
  const { isConnected } = qrlConnection;

  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!isConnected) return;
    void (async () => {
      const activePage = await StorageUtil.getActivePage();
      // Desktop retired the web settings page (Settings opens the native
      // window via navigateTo); a session stored under an older renderer may
      // still have /settings as its active page, so never restore onto it.
      const restorable =
        activePage && !(isDesktop && activePage === ROUTES.SETTINGS);
      if (restorable) {
        void Promise.resolve(navigate(activePage)).catch((error: unknown) => {
          logger.error("Failed to restore active page:", error);
        });
      } else {
        void Promise.resolve(navigate(ROUTES.HOME)).catch((error: unknown) => {
          logger.error("Failed to restore active page:", error);
        });
      }
    })().catch((error: unknown) => {
      logger.error("Failed to restore active page:", error);
    });
  }, [isConnected, navigate]);

  useEffect(() => {
    window.scrollTo(0, 0);
    void StorageUtil.setActivePage(pathname).catch((error: unknown) => {
      logger.error("Failed to save active page:", error);
    });
    // The hash router replaces history entries, so Android's back button has
    // no browser history to walk. This is the stack it walks instead.
    recordRoute(pathname);
  }, [pathname]);

  return null;
});

export default RouteMonitor;
