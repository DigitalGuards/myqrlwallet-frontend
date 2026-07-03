import RouteMonitor from "./RouteMonitor/RouteMonitor";
import { withSuspense } from "@/utils/react";
import { observer } from "mobx-react-lite";
import { lazy, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { setupActivityTracking, startAutoLockTimer, clearAutoLockTimer } from "@/utils/storage";
import NativeAppBridge from "@/components/NativeAppBridge";
import { isDesktop } from "@/desktop/bridge";
import Layout from "./Layout/Layout";
import Body from "./Body/Body";

// DApp modals are only shown when an active dApp session sends a request —
// lazy-load them so their @theqrl/web3 dependency doesn't block the
// MyQRLWallet chunk from rendering on normal page loads.
const DAppApprovalModal = withSuspense(lazy(() => import("./Body/DAppConnect/DAppApprovalModal")));
const DAppConnectionBanner = withSuspense(lazy(() => import("./Body/DAppConnect/DAppConnectionBanner")));
// Desktop-only: qrlconnect:// protocol-handler ingress + consent modal.
// Lazy so the web build never loads it (isDesktop is false there).
const DesktopDAppBridge = withSuspense(lazy(() => import("@/components/DesktopDAppBridge")));

const MyQRLWallet = observer(() => {
  const navigate = useNavigate();

  useEffect(() => {
    // Set up activity tracking to detect user interactions
    setupActivityTracking();
    
    // Start the auto-lock timer
    startAutoLockTimer(navigate);
    
    // Clean up the timer when component unmounts
    return () => {
      clearAutoLockTimer();
    };
  }, [navigate]);

  return (
    <Layout>
      <RouteMonitor />
      <NativeAppBridge />
      {isDesktop && <DesktopDAppBridge />}
      {/* Desktop surfaces connections via the sidebar dApps item + Settings
          instead of a strip floating over the wallet; web/mobile keep the
          banner as their always-visible affordance. */}
      {!isDesktop && <DAppConnectionBanner />}
      <DAppApprovalModal />
      {/* <Header /> */}
      <Body />
      {/* <Footer /> */}
    </Layout>
  );
});

export default MyQRLWallet;
