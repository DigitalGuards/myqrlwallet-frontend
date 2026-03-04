import RouteMonitor from "./RouteMonitor/RouteMonitor";
import { withSuspense } from "@/utils/react";
import { observer } from "mobx-react-lite";
import { lazy, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { setupActivityTracking, startAutoLockTimer, clearAutoLockTimer } from "@/utils/storage";
import NativeAppBridge from "@/components/NativeAppBridge";
import DAppApprovalModal from "./Body/DAppConnect/DAppApprovalModal";
import DAppConnectionBanner from "./Body/DAppConnect/DAppConnectionBanner";

// const Header = withSuspense(
//   lazy(() => import("./Header/Header"))
// );
const Body = withSuspense(
  lazy(() => import("./Body/Body"))
);
// const Footer = withSuspense(
//   lazy(() => import("./Footer/Footer"))
// );
const Layout = withSuspense(
  lazy(() => import("./Layout/Layout"))
);

const ZondWallet = observer(() => {
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

export default ZondWallet;
