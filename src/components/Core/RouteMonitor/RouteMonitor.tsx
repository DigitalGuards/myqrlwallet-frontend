import { ROUTES } from "../../../router/router";
import { useStore } from "../../../stores/store";
import { StorageUtil } from "@/utils/storage";
import { recordRoute } from "@/utils/nativeBack";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router";
import { logger } from "@/utils/log";

const RouteMonitor = observer(() => {
  const { qrlStore } = useStore();
  const { qrlConnection } = qrlStore;
  const { isConnected } = qrlConnection;

  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (!isConnected) return;
    void (async () => {
      const activePage = await StorageUtil.getActivePage();
      // The user did not move here, so the restore replaces the current
      // entry. It then adds no browser history and no step to the Back
      // trail: Back on a restored sub-page goes to its parent, as it does
      // after a fresh load.
      const restore = { replace: true } as const;
      if (activePage) {
        const navigation: unknown = Reflect.apply(navigate, undefined, [
          activePage,
          restore,
        ]);
        void Promise.resolve(navigation).catch((error: unknown) => {
          logger.error("Failed to restore active page:", error);
        });
      } else {
        void Promise.resolve(navigate(ROUTES.HOME, restore)).catch(
          (error: unknown) => {
            logger.error("Failed to restore active page:", error);
          },
        );
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
  }, [pathname]);

  // The trail Android back and the on-screen Back walk. Browser history
  // cannot tell an in-app screen from the site that opened the wallet, so
  // this records the screens of this page load. The query is part of the
  // screen: an NFT's way back is its open collection, `/?collection=...`.
  useEffect(() => {
    recordRoute(`${pathname}${search}`, navigationType);
  }, [pathname, search, navigationType]);

  return null;
});

export default RouteMonitor;
