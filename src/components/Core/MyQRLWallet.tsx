import RouteMonitor from "./RouteMonitor/RouteMonitor";
import { withSuspense } from "@/utils/react";
import { observer } from "mobx-react-lite";
import { lazy, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { setupActivityTracking, startAutoLockTimer, clearAutoLockTimer } from "@/utils/storage";
import NativeAppBridge from "@/components/NativeAppBridge";
import Layout from "./Layout/Layout";
import Body from "./Body/Body";

// DApp modals are only shown when an active dApp session sends a request —
// lazy-load them so their @theqrl/web3 dependency doesn't block the
// MyQRLWallet chunk from rendering on normal page loads.
const DAppApprovalModal = withSuspense(lazy(() => import("./Body/DAppConnect/DAppApprovalModal")));
const DAppConnectionBanner = withSuspense(lazy(() => import("./Body/DAppConnect/DAppConnectionBanner")));

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
      <DAppConnectionBanner />
      <DAppApprovalModal />
      {/* <Header /> */}
      <Body />
      {/* <Footer /> */}
    </Layout>
  );
});

export default MyQRLWallet;
