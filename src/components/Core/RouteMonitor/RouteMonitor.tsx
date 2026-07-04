import { ROUTES } from "../../../router/router";
import { useStore } from "../../../stores/store";
import { StorageUtil } from "@/utils/storage";
import { isDesktop } from "@/desktop/bridge";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const RouteMonitor = observer(() => {
  const { qrlStore } = useStore();
  const { qrlConnection } = qrlStore;
  const { isConnected } = qrlConnection;

  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    (async () => {
      const activePage = await StorageUtil.getActivePage();
      // Desktop retired the web settings page (Settings opens the native
      // window via navigateTo); a session stored under an older renderer may
      // still have /settings as its active page, so never restore onto it.
      const restorable =
        activePage && !(isDesktop && activePage === ROUTES.SETTINGS);
      if (restorable && isConnected) {
        navigate(activePage);
      } else {
        navigate(ROUTES.HOME);
      }
    })();
  }, [isConnected, navigate]);

  useEffect(() => {
    window.scrollTo(0, 0);
    StorageUtil.setActivePage(pathname);
  }, [pathname]);

  return null;
});

export default RouteMonitor;