import { ROUTES } from "../../../router/router";
import { followsBrowserHistory, historyIndex } from "@/router/pageBack";
import { useStore } from "../../../stores/store";
import { StorageUtil } from "@/utils/storage";
import { recordRoute } from "@/utils/nativeBack";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router";
import { logger } from "@/utils/log";

const RouteMonitor = observer(() => {
  const { qrlStore } = useStore();
  const { qrlConnection } = qrlStore;
  const { isConnected } = qrlConnection;

  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const navigationType = useNavigationType();

  // The page shown, for the restore below when the stored page arrives. A
  // ref keeps the restore to one run per connection.
  const shownPathname = useRef(pathname);
  useEffect(() => {
    shownPathname.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!isConnected) return;
    void (async () => {
      const activePage = await StorageUtil.getActivePage();
      const page: unknown = activePage ? activePage : ROUTES.HOME;
      // Restoring the page already shown replaces its entry, so history
      // holds it once. Any other page is pushed, so the page that was
      // opened (a deep link, or /dapp-sessions from a dApp's link) stays
      // one browser Back away.
      const navigation: unknown = Reflect.apply(
        navigate,
        undefined,
        page === shownPathname.current ? [page, { replace: true }] : [page],
      );
      void Promise.resolve(navigation).catch((error: unknown) => {
        logger.error("Failed to restore active page:", error);
      });
    })().catch((error: unknown) => {
      logger.error("Failed to restore active page:", error);
    });
  }, [isConnected, navigate]);

  // A new page opens at its top, with its Back in view. `#root` is the
  // scroll container (src/index.css), so the window alone never moves; it
  // is scrolled too in case that layout is missing. A change of the query
  // or the fragment alone keeps the position.
  useEffect(() => {
    const root = document.getElementById("root");
    if (root) root.scrollTop = 0;
    window.scrollTo(0, 0);
    void StorageUtil.setActivePage(pathname).catch((error: unknown) => {
      logger.error("Failed to save active page:", error);
    });
  }, [pathname]);

  // The trail Android back and the on-screen Back walk. Browser history
  // cannot tell an in-app screen from the site that opened the wallet, so
  // this records the screens of this page load. The query is part of the
  // screen: an NFT's way back is its open collection, `/?collection=...`.
  // On the web wallet each screen also carries its history index, so Back
  // can step the browser's history when the previous screen is right behind.
  useEffect(() => {
    recordRoute(
      `${pathname}${search}`,
      navigationType,
      followsBrowserHistory() ? historyIndex() : undefined,
    );
  }, [pathname, search, navigationType]);

  return null;
});

export default RouteMonitor;
