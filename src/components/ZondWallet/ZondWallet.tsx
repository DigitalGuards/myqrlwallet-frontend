import RouteMonitor from "./RouteMonitor/RouteMonitor";
import withSuspense from "../../functions/withSuspense";
import { observer } from "mobx-react-lite";
import { lazy } from "react";
import { Toaster } from "@/components/UI/toaster"

const Header = withSuspense(
  lazy(() => import("./Header/Header"))
);
const Body = withSuspense(
  lazy(() => import("./Body/Body"))
);
const Footer = withSuspense(
  lazy(() => import("./Footer/Footer"))
);

const ZondWallet = observer(() => {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <RouteMonitor />
      <Header />
      <main className="flex-1 w-full mb-16 md:mb-0">
        <Body />
      </main>
      <Footer />
      <Toaster />
    </div>
  );
});

export default ZondWallet;
