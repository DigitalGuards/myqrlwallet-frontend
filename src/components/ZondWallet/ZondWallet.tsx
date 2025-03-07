import RouteMonitor from "./RouteMonitor/RouteMonitor";
import withSuspense from "../../functions/withSuspense";
import { observer } from "mobx-react-lite";
import { lazy } from "react";
import { Toaster } from "@/components/UI/toaster"

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
  return (
    <Layout>
      <RouteMonitor />
      {/* <Header /> */}
      <Body />
      {/* <Footer /> */}
      <Toaster />
    </Layout>
  );
});

export default ZondWallet;
