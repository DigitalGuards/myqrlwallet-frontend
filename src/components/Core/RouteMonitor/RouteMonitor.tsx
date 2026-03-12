import { ROUTES } from "../../../router/router";
import { useStore } from "../../../stores/store";
import { StorageUtil } from "@/utils/storage";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const RouteMonitor = observer(() => {
  const { zondStore } = useStore();
  const { zondConnection } = zondStore;
  const { isConnected } = zondConnection;

  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    (async () => {
      const activePage = await StorageUtil.getActivePage();
      if (activePage && isConnected) {
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